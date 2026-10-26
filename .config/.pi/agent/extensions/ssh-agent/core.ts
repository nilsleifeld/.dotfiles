import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { chmod, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const BIN = { add: "/usr/bin/ssh-add", agent: "/usr/bin/ssh-agent", keygen: "/usr/bin/ssh-keygen" };
export const clean = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, "?").slice(0, 2000);
export const expandPath = (path: string, home = homedir()) => resolve(path === "~" ? home : path.replace(/^~\//, `${home}/`));

export interface Result { code: number | null; stdout: string; stderr: string }
export function run(file: string, args: string[], options: {
	env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number; capture?: boolean; fileDescriptor?: number;
} = {}): Promise<Result> {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) return reject(new Error("Vorgang abgebrochen."));
		const child = spawn(file, args, {
			env: { ...process.env, LC_ALL: "C", ...options.env },
			stdio: options.fileDescriptor === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", options.fileDescriptor],
		});
		let stdout = "", stderr = "", expired = false;
		const stop = () => child.kill("SIGKILL");
		const timer = setTimeout(() => { expired = true; stop(); }, options.timeout ?? 5000);
		options.signal?.addEventListener("abort", stop, { once: true });
		if (options.signal?.aborted) stop();
		child.stdout!.on("data", (b: Buffer) => { if (options.capture !== false) stdout = (stdout + b.toString()).slice(0, 65536); });
		child.stderr!.on("data", (b: Buffer) => { if (options.capture !== false) stderr = (stderr + b.toString()).slice(0, 65536); });
		const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); };
		child.once("error", () => { cleanup(); reject(new Error("OpenSSH-Prozess konnte nicht gestartet werden.")); });
		child.once("close", (code) => {
			cleanup();
			if (expired || options.signal?.aborted) reject(new Error(expired ? "Zeitlimit überschritten." : "Vorgang abgebrochen."));
			else resolve({ code, stdout, stderr });
		});
	});
}

export interface Key { path: string; fingerprint?: string; revision: string }
const privateHeader = /^-----BEGIN (?:OPENSSH |RSA |DSA |EC |ENCRYPTED )?PRIVATE KEY-----/;
async function openKey(path: string) {
	const canonical = await realpath(expandPath(path));
	const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 1024 * 1024) {
			throw new Error("Key muss eine eigene reguläre Datei mit Modus 0600 oder strenger sein.");
		}
		const head = Buffer.alloc(100);
		await handle.read(head, 0, head.length, 0);
		if (!privateHeader.test(head.toString("ascii"))) throw new Error("Kein unterstützter privater SSH-Key.");
		return { canonical, handle, revision: `${canonical}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}` };
	} catch (error) { await handle.close(); throw error; }
}

export async function inspectKey(path: string): Promise<Key> {
	const { canonical, handle, revision } = await openKey(path);
	try {
		// ssh-keygen requires a pathname (not /dev/fd on macOS); loading below uses a pinned FD.
		const result = await run(BIN.keygen, ["-l", "-E", "sha256", "-f", canonical], {
			env: { SSH_ASKPASS: "/usr/bin/false", SSH_ASKPASS_REQUIRE: "force", DISPLAY: "pi-ssh:0" },
		});
		return { path: canonical, revision, fingerprint: result.code === 0 ? result.stdout.match(/SHA256:[A-Za-z0-9+/]+/)?.[0] : undefined };
	} finally { await handle.close(); }
}

// Static discovery only: never evaluate Match exec, ProxyCommand, or a shell.
export function configWords(line: string): string[] {
	const words: string[] = [];
	let word = "", quote = "", escaped = false;
	for (const ch of line) {
		if (escaped) { word += ch; escaped = false; }
		else if (ch === "\\") escaped = true;
		else if (quote) { if (ch === quote) quote = ""; else word += ch; }
		else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "#") break;
		else if (/\s|=/.test(ch)) { if (word) { words.push(word); word = ""; } }
		else word += ch;
	}
	if (word) words.push(word);
	return words;
}

async function readSmall(path: string): Promise<string> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > 1024 * 1024) return "";
		return await handle.readFile("utf8");
	} finally { await handle.close(); }
}

async function includeFiles(pattern: string): Promise<string[]> {
	if (!/[?*]/.test(pattern)) return [pattern];
	// shortcut: globs only in the final component; use a literal Include for nested glob directories.
	if (/[?*]/.test(dirname(pattern))) return [];
	const regex = new RegExp("^" + pattern.slice(dirname(pattern).length + 1).split("").map((ch) => ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "$");
	return (await readdir(dirname(pattern)).catch(() => [])).filter((name) => regex.test(name)).sort().map((name) => join(dirname(pattern), name));
}

export async function discoverKeys(home = homedir()): Promise<Key[]> {
	const ssh = join(home, ".ssh"), paths = new Set<string>(), seen = new Set<string>();
	for (const name of await readdir(ssh).catch(() => [])) paths.add(join(ssh, name));
	const config = async (path: string, depth = 0): Promise<void> => {
		if (depth > 8 || seen.size > 100 || seen.has(path)) return;
		seen.add(path);
		const text = await readSmall(path).catch(() => "");
		for (const line of text.split(/\r?\n/)) {
			const [directive, ...values] = configWords(line);
			if (directive?.toLowerCase() === "identityfile" && values.length === 1) {
				const value = values[0].replace(/%%|%d|%u/g, (token) => token === "%d" ? home : token === "%u" ? process.env.USER ?? "" : "%");
				if (!/%[a-zA-Z]|\$\{/.test(value) && value !== "none") paths.add(expandPath(value, home));
			}
			if (directive?.toLowerCase() === "include") for (const value of values) {
				const pattern = value.startsWith("~") ? expandPath(value, home) : isAbsolute(value) ? value : join(ssh, value);
				for (const included of await includeFiles(pattern)) await config(included, depth + 1);
			}
		}
	};
	await config(join(ssh, "config"));
	const keys = new Map<string, Key>();
	for (const path of [...paths].sort()) {
		try { const key = await inspectKey(path); keys.set(key.path, key); } catch { /* Non-keys and unsafe files are not selectable. */ }
	}
	return [...keys.values()];
}

export interface AgentStatus { available: boolean; keys: string[] }
export class Agent {
	private child?: ChildProcess;
	private dir?: string;
	private socket?: string;
	private previous?: string;
	private starting?: Promise<void>;
	private closed = false;

	async status(): Promise<AgentStatus> {
		try {
			const r = await run(BIN.add, ["-l", "-E", "sha256"]);
			return { available: r.code === 0 || r.code === 1, keys: r.code === 0 ? r.stdout.trim().split("\n").filter(Boolean).map(clean) : [] };
		} catch { return { available: false, keys: [] }; }
	}

	async ensure(): Promise<void> {
		if (this.closed) throw new Error("SSH-Verwaltung wurde beendet.");
		if (this.starting) return this.starting;
		this.starting = this.start();
		try { await this.starting; }
		catch (error) { await this.stopOwned(); throw error; }
		finally { this.starting = undefined; }
	}

	private async start(): Promise<void> {
		if ((await this.status()).available) return;
		await this.stopOwned();
		if (this.closed) throw new Error("SSH-Verwaltung wurde beendet.");
		this.previous = process.env.SSH_AUTH_SOCK;
		this.dir = await mkdtemp("/tmp/pi-ssh-");
		await chmod(this.dir, 0o700);
		this.socket = join(this.dir, "agent");
		let failed = false;
		this.child = spawn(BIN.agent, ["-D", "-a", this.socket], { stdio: "ignore" });
		this.child.on("error", () => { failed = true; });
		this.child.on("exit", () => { failed = true; });
		for (let i = 0; i < 50 && !failed && !this.closed; i++) {
			try {
				const r = await run(BIN.add, ["-l"], { env: { SSH_AUTH_SOCK: this.socket }, timeout: 1000 });
				if (r.code === 0 || r.code === 1) {
					process.env.SSH_AUTH_SOCK = this.socket;
					return;
				}
			} catch { /* Wait briefly for the socket to become ready. */ }
			await new Promise((r) => setTimeout(r, 40));
		}
		await this.stopOwned();
		throw new Error("SSH-Agent konnte nicht gestartet werden.");
	}

	private async stopOwned(): Promise<void> {
		const child = this.child;
		this.child = undefined;
		if (child?.pid && child.exitCode === null && child.signalCode === null) {
			await new Promise<void>((done) => {
				const timer = setTimeout(() => { child.kill("SIGKILL"); }, 1000);
				child.once("close", () => { clearTimeout(timer); done(); });
				child.kill("SIGTERM");
			});
		}
		if (this.socket && process.env.SSH_AUTH_SOCK === this.socket) {
			if (this.previous === undefined) delete process.env.SSH_AUTH_SOCK;
			else process.env.SSH_AUTH_SOCK = this.previous;
		}
		if (this.dir) await rm(this.dir, { recursive: true, force: true });
		this.dir = this.socket = undefined;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.starting?.catch(() => {});
		await this.stopOwned();
	}
}

// This child only writes the secret to ssh-add's private askpass pipe, never to Pi's output.
function helperSource(socket: string, token: string): string {
	return `#!${process.execPath}
const net = require('node:net');
const s = net.connect(${JSON.stringify(socket)});
let chunks = [], size = 0;
s.setTimeout(120000, () => { s.destroy(); process.exitCode = 1; });
s.on('error', () => { process.exitCode = 1; });
s.on('connect', () => s.write(${JSON.stringify(token + "\n")}));
s.on('data', b => { size += b.length; if (size > 65536) s.destroy(); else chunks.push(b); });
s.on('end', () => {
 const b = Buffer.concat(chunks); chunks.forEach(c => c.fill(0)); chunks = [];
 if (b[0] === 1) process.stdout.write(b.subarray(1), () => b.fill(0));
 else { b.fill(0); process.exitCode = 1; }
});
`;
}

type Prompt = (attempt: number, signal: AbortSignal) => Promise<Buffer | undefined>;
export async function addKey(key: Key, prompt: Prompt, signal?: AbortSignal): Promise<void> {
	// Pin the validated inode: ssh-add must not reopen a path swapped after the UI selection.
	const { handle } = await openKey(key.path);
	try { await addPinnedKey(handle.fd, prompt, signal); }
	finally { await handle.close(); }
}

async function addPinnedKey(fd: number, prompt: Prompt, signal?: AbortSignal): Promise<void> {
	const dir = await mkdtemp(`/tmp/pi-askpass-${process.pid}-`);
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) abort();
	const sockets = new Set<Socket>();
	let attempts = 0, serving = false, cancelled = false;
	const token = randomBytes(32).toString("hex");
	const socketPath = join(dir, "ipc"), helper = join(dir, "askpass");
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("error", () => {});
		socket.on("close", () => sockets.delete(socket));
		socket.setTimeout(120000, () => socket.destroy());
		let request = "";
		const receive = (data: Buffer) => {
			request += data.toString("ascii");
			if (request.length > token.length + 1) return socket.destroy();
			if (!request.endsWith("\n")) return;
			socket.removeListener("data", receive);
			if (request !== token + "\n" || serving || attempts >= 3 || controller.signal.aborted) return socket.destroy();
			serving = true;
			void (async () => {
				let secret: Buffer | undefined;
				try {
					secret = await prompt(++attempts, controller.signal);
					if (!secret || controller.signal.aborted || [0, 10, 13].some((byte) => secret!.includes(byte))) {
						cancelled = true; socket.end(Buffer.from([0])); controller.abort();
					} else {
						const response = Buffer.concat([Buffer.from([1]), secret, Buffer.from("\n")]);
						socket.end(response, () => response.fill(0));
					}
				} catch { cancelled = true; socket.destroy(); controller.abort(); }
				finally { secret?.fill(0); serving = false; }
			})();
		};
		socket.on("data", receive);
	});
	const timeout = setTimeout(abort, 180000);
	try {
		await chmod(dir, 0o700);
		await writeFile(helper, helperSource(socketPath, token), { mode: 0o700, flag: "wx" });
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
		await chmod(socketPath, 0o600);
		const r = await run(BIN.add, ["/dev/fd/3"], {
			fileDescriptor: fd,
			env: { SSH_ASKPASS: helper, SSH_ASKPASS_REQUIRE: "force", DISPLAY: "pi-ssh:0" },
			timeout: 180000, signal: controller.signal, capture: false,
		});
		if (r.code !== 0) throw new Error("Key konnte nicht geladen werden (Passphrase, Dateiformat oder Agent prüfen; maximal drei Versuche).");
	} catch (error) {
		if (cancelled || signal?.aborted) throw new Error("Entsperren abgebrochen.");
		if (controller.signal.aborted) throw new Error("Zeitlimit beim Entsperren überschritten.");
		throw error;
	} finally {
		clearTimeout(timeout);
		controller.abort();
		signal?.removeEventListener("abort", abort);
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((done) => server.close(() => done()));
		await rm(dir, { recursive: true, force: true });
	}
}

export async function removeKey(line: string): Promise<void> {
	const fingerprint = line.match(/SHA256:[A-Za-z0-9+/]+/)?.[0];
	if (!fingerprint) throw new Error("Ungültiger Fingerprint.");
	const publicKeys = await run(BIN.add, ["-L"]);
	if (publicKeys.code !== 0) throw new Error("Geladene Keys konnten nicht gelesen werden.");
	const dir = await mkdtemp(`/tmp/pi-ssh-lock-${process.pid}-`);
	try {
		await chmod(dir, 0o700);
		const file = join(dir, "public");
		for (const key of publicKeys.stdout.trim().split("\n")) {
			await writeFile(file, key + "\n", { mode: 0o600 });
			const r = await run(BIN.keygen, ["-l", "-E", "sha256", "-f", file]);
			if (r.stdout.split(/\s+/).includes(fingerprint)) {
				if ((await run(BIN.add, ["-d", file])).code !== 0) throw new Error("Key konnte nicht entfernt werden.");
				return;
			}
		}
		throw new Error("Key ist nicht mehr geladen.");
	} finally { await rm(dir, { recursive: true, force: true }); }
}

export function publicKeyFailure(output: string): boolean {
	return /Permission denied \([^\r\n)]*publickey[^\r\n)]*\)/i.test(output) &&
		!/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Could not resolve hostname|Connection refused|Connection timed out|Too many authentication failures/i.test(output);
}

// Deliberately not a shell parser: only recognize simple commands, never execute the extracted text.
export function sshCommand(command: string): boolean {
	return !/[\n\r;&|`$<>]/.test(command) && /^(?:git\s+(?:clone|fetch|pull|push)\b|ssh\s+)/.test(command.trim());
}
