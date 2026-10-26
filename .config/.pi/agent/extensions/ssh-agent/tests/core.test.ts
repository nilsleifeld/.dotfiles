import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import { chmod, copyFile, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { Agent, addKey, configWords, discoverKeys, inspectKey, publicKeyFailure, removeKey, run, sshCommand } from "../core.ts";
import { Secret } from "../secret.ts";

let home: string, plain: string, encrypted: string, native: string;
const fixturePassphrase = "only-a-generated-test-fixture-ä!";
const originalSocket = process.env.SSH_AUTH_SOCK;
let agent: Agent;
const temporary = async () => (await readdir("/tmp")).filter((name) => new RegExp(`^pi-(?:askpass|ssh-lock)-${process.pid}-`).test(name)).sort();

before(async () => {
	home = await realpath(await mkdtemp("/tmp/pi-ssh-test-"));
	await mkdir(join(home, ".ssh"), { mode: 0o700 });
	plain = join(home, ".ssh", "unusual name;$(never-executed)");
	assert.equal((await run("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-f", plain, "-N", ""])).code, 0);
	encrypted = join(home, "rsa-encrypted");
	// The dummy fixture password only exists in test memory, never in process argv/env.
	const pair = await promisify(generateKeyPair)("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: fixturePassphrase },
	});
	await writeFile(encrypted, pair.privateKey, { mode: 0o600 });
	// Encrypt a native OpenSSH Ed25519 fixture without passing the password in argv/env/files.
	native = join(home, "native-ed25519");
	await copyFile(plain, native);
	const socket = join(home, "fixture-ipc"), helper = join(home, "fixture-askpass");
	const server = createServer((client) => client.end(Buffer.from(fixturePassphrase + "\n")));
	await new Promise<void>((resolve) => server.listen(socket, resolve));
	await chmod(socket, 0o600);
	await writeFile(helper, `#!${process.execPath}\nrequire('node:net').connect(${JSON.stringify(socket)}).pipe(process.stdout);\n`, { mode: 0o700 });
	try {
		assert.equal((await run("/usr/bin/ssh-keygen", ["-p", "-q", "-f", native, "-P", ""], {
			env: { SSH_ASKPASS: helper, SSH_ASKPASS_REQUIRE: "force", DISPLAY: "pi-test:0" }, capture: false,
		})).code, 0);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(helper);
	}
	await writeFile(join(home, ".ssh", "config"), 'Host example\n IdentityFile "' + encrypted + '"\n Include conf.d/*.conf\n Match exec "touch ' + home + '/SHOULD-NOT-EXIST"\n', { mode: 0o600 });
	await mkdir(join(home, ".ssh", "conf.d"));
	await writeFile(join(home, ".ssh", "conf.d", "test.conf"), 'IdentityFile "' + plain + '"\nInclude ../config\n');
	process.env.SSH_AUTH_SOCK = join(home, "missing-socket");
	agent = new Agent();
});
after(async () => {
	await agent?.close();
	if (originalSocket === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = originalSocket;
	await rm(home, { recursive: true, force: true });
});

test("static config tokenizer handles quotes, comments and equals", () => {
	assert.deepEqual(configWords('IdentityFile = "~/.ssh/a b" # comment'), ["IdentityFile", "~/.ssh/a b"]);
});
test("discovers arbitrary key names and IdentityFile/Include without executing config", async () => {
	const keys = await discoverKeys(home);
	assert.deepEqual(keys.map((key) => key.path).sort(), [plain, encrypted].sort());
	assert.ok(keys.find((key) => key.path === plain)?.fingerprint?.startsWith("SHA256:"));
	assert.ok(!(await readdir(home)).includes("SHOULD-NOT-EXIST"));
});
test("rejects public keys, unsafe permissions, directories, missing paths and FIFOs", async () => {
	await assert.rejects(inspectKey(plain + ".pub"));
	await assert.rejects(inspectKey(home));
	await assert.rejects(inspectKey(join(home, "missing")));
	await chmod(encrypted, 0o644);
	await assert.rejects(inspectKey(encrypted));
	await chmod(encrypted, 0o600);
	const fifo = join(home, "fifo");
	assert.equal((await run("/usr/bin/mkfifo", [fifo])).code, 0);
	await assert.rejects(inspectKey(fifo));
});
test("starts exactly one agent concurrently and publishes its socket", async () => {
	assert.equal((await agent.status()).available, false);
	await Promise.all([agent.ensure(), agent.ensure(), agent.ensure()]);
	assert.ok(process.env.SSH_AUTH_SOCK?.startsWith("/tmp/pi-ssh-"));
	assert.deepEqual(await agent.status(), { available: true, keys: [] });
	const socket = process.env.SSH_AUTH_SOCK;
	await agent.ensure();
	assert.equal(process.env.SSH_AUTH_SOCK, socket);
});
test("reuses existing agent and never kills a borrowed agent", async () => {
	const borrowed = new Agent();
	const socket = process.env.SSH_AUTH_SOCK;
	await borrowed.ensure(); await borrowed.close(); await borrowed.close();
	assert.equal(process.env.SSH_AUTH_SOCK, socket);
	assert.equal((await agent.status()).available, true);
});
test("loads an unencrypted key without asking and removes selected fingerprint", async () => {
	await addKey(await inspectKey(plain), async () => { assert.fail("No passphrase necessary"); });
	const status = await agent.status();
	assert.equal(status.keys.length, 1);
	await removeKey(status.keys[0]);
	assert.equal((await agent.status()).keys.length, 0);
});
test("loads encrypted RSA via private IPC, retries wrong input, wipes buffer, cleans up", async () => {
	const dirs = await temporary();
	const attempts: number[] = [], secrets: Buffer[] = [];
	await addKey(await inspectKey(encrypted), async (attempt) => {
		attempts.push(attempt);
		const secret = Buffer.from(attempt === 1 ? "incorrect" : fixturePassphrase);
		secrets.push(secret); return secret;
	});
	assert.deepEqual(attempts, [1, 2]);
	assert.ok(secrets.every((secret) => secret.every((byte) => byte === 0)));
	assert.equal((await agent.status()).keys.length, 1);
	assert.deepEqual(await temporary(), dirs);
	await removeKey((await agent.status()).keys[0]);
});
test("loads encrypted native OpenSSH Ed25519 with a readable public fingerprint", async () => {
	const key = await inspectKey(native);
	assert.ok(key.fingerprint?.startsWith("SHA256:"));
	let prompts = 0;
	await addKey(key, async () => { prompts++; return Buffer.from(fixturePassphrase); });
	assert.equal(prompts, 1);
	const status = await agent.status();
	assert.ok(status.keys[0].includes(key.fingerprint!));
	await removeKey(status.keys[0]);
});

test("caps wrong-passphrase attempts and cleans IPC resources", async () => {
	const dirs = await temporary();
	let attempts = 0;
	await assert.rejects(addKey(await inspectKey(encrypted), async () => { attempts++; return Buffer.from("wrong"); }));
	assert.equal(attempts, 3);
	assert.deepEqual(await temporary(), dirs);
});
test("cancels safely and does not load key", async () => {
	const dirs = await temporary();
	await assert.rejects(addKey(await inspectKey(encrypted), async () => undefined), /abgebrochen/);
	assert.equal((await agent.status()).keys.length, 0);
	assert.deepEqual(await temporary(), dirs);
});
test("abort dismisses pending passphrase interaction and cleans resources", async () => {
	const dirs = await temporary(), controller = new AbortController();
	await assert.rejects(addKey(await inspectKey(encrypted), async (_attempt, signal) => {
		return await new Promise<undefined>((resolve) => {
			signal.addEventListener("abort", () => resolve(undefined), { once: true });
			controller.abort();
		});
	}, controller.signal));
	assert.deepEqual(await temporary(), dirs);
});
test("rejects newline injection in passphrase", async () => {
	await assert.rejects(addKey(await inspectKey(encrypted), async () => Buffer.from("wrong\nextra")));
});
test("distinguishes publickey rejection from other transport/auth failures", () => {
	assert.equal(publicKeyFailure("git@example: Permission denied (publickey)."), true);
	assert.equal(publicKeyFailure("Permission denied (publickey,password)."), true);
	for (const message of ["Permission denied", "Permission denied (password).", "Host key verification failed.", "Could not resolve hostname", "Connection refused", "Too many authentication failures", "REMOTE HOST IDENTIFICATION HAS CHANGED\nPermission denied (publickey)"]) {
		assert.equal(publicKeyFailure(message), false);
	}
	assert.equal(sshCommand("git clone git@example:repo.git"), true);
	assert.equal(sshCommand("git push origin main"), true);
	assert.equal(sshCommand("ssh user@example uptime"), true);
	assert.equal(sshCommand("git pull; rm -rf example"), false);
	assert.equal(sshCommand("cd project && git fetch"), false);
});
test("secret input masks, edits UTF-8, rejects controls and never retains returned data", () => {
	const secret = new Secret();
	secret.append("secret-ä");
	assert.equal(secret.mask, "••••••••");
	secret.backspace();
	secret.append("ö");
	secret.append("\x1b[31m");
	const result = secret.take();
	assert.equal(result.toString(), "secret-ö");
	assert.equal(secret.mask, "");
	result.fill(0);
	assert.equal(secret.inputPaste("\x1b[200~paste"), true);
	assert.equal(secret.inputPaste("d\x1b[201~"), true);
	assert.equal(secret.take().toString(), "pasted");
	secret.inputPaste("\x1b[200~line1\nline2\x1b[201~");
	assert.equal(secret.take().length, 0);
});
test("terminates timed-out processes and handles missing executable", async () => {
	await assert.rejects(run("/bin/sleep", ["10"], { timeout: 20 }), /Zeitlimit/);
	await assert.rejects(run("/nonexistent/pi-ssh-test", []), /OpenSSH/);
});
test("owned agent is terminated, original socket restored, cleanup idempotent", async () => {
	await agent.close(); await agent.close();
	assert.equal(process.env.SSH_AUTH_SOCK, join(home, "missing-socket"));
	assert.equal((await agent.status()).available, false);
});
