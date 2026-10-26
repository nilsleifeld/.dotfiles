import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// PI_TEST_HOST points to an installed Pi package.json when testing against the CLI's bundled API.
const require = createRequire(process.env.PI_TEST_HOST ?? new URL("../package.json", import.meta.url));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { alias: Object.fromEntries(
	["pi-ai", "pi-tui", "pi-coding-agent"].map((name) => {
		const full = `@earendil-works/${name}`;
		const path = process.env.PI_TEST_HOST ? new URL(name === "pi-coding-agent" ? "./dist/index.js" : `./node_modules/${full}/dist/index.js`, `file://${process.env.PI_TEST_HOST}`) : new URL(import.meta.resolve(full));
		return [full, fileURLToPath(path)];
	})),
});
const { passphrase } = await jiti.import("../ui.ts");
const { default: extension } = await jiti.import("../index.ts");

type Component = { render(width: number): string[]; handleInput(data: string): void; dispose(): void };
function mock() {
	const events = new Map<string, Function>(), commands = new Map<string, any>(), tools = new Map<string, any>();
	const statuses: string[] = [], notifications: string[] = [];
	let component: Component | undefined;
	let confirmations = 0;
	const ctx = {
		cwd: process.cwd(), hasUI: true, mode: "tui",
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus: (_key: string, text: string) => statuses.push(text),
			notify: (text: string) => notifications.push(text),
			confirm: async () => { confirmations++; return false; },
			custom: async (factory: Function) => await new Promise((resolve) => {
				component = factory({ requestRender() {} }, { fg: (_: string, text: string) => text }, {}, (value: unknown) => { component?.dispose(); resolve(value); });
			}),
		},
	} as unknown as ExtensionContext;
	const pi = {
		on: (name: string, handler: Function) => events.set(name, handler),
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: any) => commands.set(name, command),
	} as unknown as ExtensionAPI;
	return { pi, ctx, events, commands, tools, statuses, notifications, component: () => component!, confirmations: () => confirmations };
}

test("uses installed Pi API: registers tool, commands, hooks and official bash wrapper", () => {
	const state = mock(); extension(state.pi);
	assert.deepEqual([...state.commands.keys()].sort(), ["ssh-keys", "ssh-lock", "ssh-status", "ssh-unlock"]);
	assert.ok(state.tools.has("ssh_unlock")); assert.ok(state.tools.has("bash"));
	for (const name of ["session_start", "session_shutdown", "agent_start", "tool_call", "tool_result"]) assert.ok(state.events.has(name));
});
test("official Pi extension loader loads the on-disk entry point without errors", async () => {
	const main = process.env.PI_TEST_HOST ? new URL("./dist/index.js", `file://${process.env.PI_TEST_HOST}`) : new URL(import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { loadExtensions } = await import(new URL("./core/extensions/loader.js", main).href);
	const result = await loadExtensions([fileURLToPath(new URL("../index.ts", import.meta.url))], process.cwd());
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 1);
	assert.ok(result.extensions[0].tools.has("ssh_unlock"));
	assert.ok(result.extensions[0].commands.has("ssh-status"));
});

test("actual custom UI renders masks only; supports UTF-8, backspace and Kitty input", async () => {
	const state = mock(), controller = new AbortController();
	const promise = passphrase(state.ctx, 1, controller.signal);
	const component = state.component();
	component.handleInput("local-secret-ä");
	component.handleInput("\x7f");
	component.handleInput("\x1b[246u"); // ö, Kitty CSI-u
	assert.ok(!component.render(100).join("\n").includes("secret"));
	assert.ok(component.render(100).join("\n").includes("••••••••"));
	component.handleInput("\r");
	const secret = await promise;
	assert.equal(secret.toString(), "local-secret-ö"); secret.fill(0);
	assert.equal(state.notifications.length, 0);
});
test("custom UI cancellation and abort never return partial secret", async () => {
	for (const mode of ["escape", "abort"]) {
		const state = mock(), controller = new AbortController();
		const promise = passphrase(state.ctx, 1, controller.signal);
		state.component().handleInput("secret");
		if (mode === "escape") state.component().handleInput("\x1b"); else controller.abort();
		assert.equal(await promise, undefined);
	}
});
test("secure UI and model tool reject RPC/non-interactive contexts", async () => {
	const state = mock(); extension(state.pi);
	const ctx = { ...state.ctx, mode: "rpc" };
	assert.throws(() => passphrase(ctx, 1, new AbortController().signal), /lokale Pi-TUI/);
	await assert.rejects(state.tools.get("ssh_unlock").execute("id", {}, undefined, undefined, ctx), /lokale Pi-TUI/);
});
test("auth failure offers unlock at most once; no command is executed/replayed", async () => {
	const state = mock(); extension(state.pi);
	const event = { toolName: "bash", input: { command: "git push origin main" }, isError: true, content: [{ type: "text", text: "Permission denied (publickey)." }] };
	await state.events.get("tool_result")!(event, state.ctx);
	await state.events.get("tool_result")!(event, state.ctx);
	assert.equal(state.confirmations(), 1);
	const result = await state.events.get("tool_call")!({ toolName: "bash", input: event.input }, state.ctx);
	assert.equal(result.block, true);
	assert.equal(state.confirmations(), 2);
});
test("host-key and network failures do not cause unlock dialogs", async () => {
	const state = mock(); extension(state.pi);
	for (const text of ["Host key verification failed.", "Connection refused", "Permission denied (password).", "Too many authentication failures"]) {
		await state.events.get("tool_result")!({ toolName: "bash", input: { command: "ssh host" }, isError: true, content: [{ type: "text", text }] }, state.ctx);
	}
	assert.equal(state.confirmations(), 0);
});
test("persistent status is set on session start and cleared on shutdown", async () => {
	const state = mock(); extension(state.pi);
	await state.events.get("session_start")!({}, state.ctx);
	assert.match(state.statuses[0], /SSH:/);
	assert.doesNotMatch(state.statuses[0], /verbunden|authentifiziert/i);
	await state.events.get("session_shutdown")!({}, state.ctx);
	assert.equal(state.statuses.at(-1), undefined);
});
test("model tool loads encrypted key, never returns secret, and avoids a second prompt", async () => {
	const state = mock(); extension(state.pi);
	const dir = await mkdtemp("/tmp/pi-extension-test-");
	const socket = process.env.SSH_AUTH_SOCK, home = process.env.HOME;
	const password = "local-test-only-passphrase";
	const pair = await promisify(generateKeyPair)("rsa", {
		modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: password },
	});
	let prompts = 0;
	Object.assign(state.ctx.ui, { confirm: async () => true, custom: async () => { prompts++; return Buffer.from(password); } });
	process.env.SSH_AUTH_SOCK = join(dir, "missing");
	process.env.HOME = dir;
	try {
		const keyPath = join(dir, "key");
		await writeFile(keyPath, pair.privateKey, { mode: 0o600 });
		const tool = state.tools.get("ssh_unlock");
		Object.assign(state.ctx.ui, {
			select: async (_title: string, options: string[]) => {
				assert.ok(options.includes("Anderen Key-Pfad eingeben …"));
				return "Anderen Key-Pfad eingeben …";
			},
			input: async () => keyPath,
		});
		const result = await tool.execute("id", {}, undefined, undefined, state.ctx);
		assert.ok(!JSON.stringify(result).includes(password));
		assert.match(result.content[0].text, /geladen/);
		const status = await state.tools.get("bash").execute("status", { command: "/usr/bin/ssh-add -l" }, undefined, undefined, state.ctx);
		assert.match(status.content[0].text, /SHA256:/);
		const again = await tool.execute("id2", { keyPath }, undefined, undefined, state.ctx);
		assert.match(again.content[0].text, /bereits/);
		assert.equal(prompts, 1);
	} finally {
		await state.events.get("session_shutdown")!({}, state.ctx);
		if (socket === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = socket;
		if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
		await rm(dir, { recursive: true, force: true });
	}
});

test("bash wrapper forces fail-closed askpass instead of terminal passphrase prompts", async () => {
	const state = mock(); extension(state.pi);
	const result = await state.tools.get("bash").execute("id", { command: 'printf "%s %s" "$SSH_ASKPASS" "$SSH_ASKPASS_REQUIRE"' }, undefined, undefined, state.ctx);
	assert.equal(result.content[0].text, "/usr/bin/false force");
});
