import { createBashTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { Agent, addKey, clean, discoverKeys, inspectKey, publicKeyFailure, removeKey, run, sshCommand } from "./core.ts";
import { passphrase } from "./ui.ts";

export default function (pi: ExtensionAPI) {
	let agent = new Agent();
	let context: ExtensionContext | undefined;
	let poll: ReturnType<typeof setInterval> | undefined;
	let busy = false, refreshing = false, autoOffered = false;
	let operation: AbortController | undefined;
	let pending: Promise<string> | undefined;
	const failedCommands = new Set<string>();
	// Legacy encrypted PEM has no readable public identity until unlocked in this runtime.
	const unlocked = new Map<string, string>();
	const fingerprintOf = (key: { revision: string; fingerprint?: string }) => key.fingerprint ?? unlocked.get(key.revision);

	const interactive = (ctx: ExtensionContext) => ctx.hasUI && ctx.mode === "tui";
	async function refresh(ctx = context) {
		if (!ctx || !ctx.hasUI || refreshing) return;
		refreshing = true;
		try {
			const status = await agent.status();
			if (ctx !== context) return;
			const text = busy ? "🔄 SSH: Entsperrung läuft" : !status.available ? "🔴 SSH: Kein Agent" :
				status.keys.length === 0 ? "🟡 SSH: Kein Key geladen" : `🟢 SSH: ${status.keys.length} ${status.keys.length === 1 ? "Key" : "Keys"} geladen`;
			ctx.ui.setStatus("ssh-agent", ctx.ui.theme.fg(busy ? "accent" : !status.available ? "error" : status.keys.length ? "success" : "warning", text));
		} finally { refreshing = false; }
	}

	async function performUnlock(ctx: ExtensionContext, path?: string, signal?: AbortSignal): Promise<string> {
		if (!interactive(ctx)) throw new Error("Entsperren benötigt die lokale Pi-TUI. In RPC/Print/JSON bitte einen extern entsperrten Agenten bereitstellen.");
		if (signal?.aborted) throw new Error("Vorgang abgebrochen.");
		let key;
		if (path) {
			key = await inspectKey(path);
			if (!(await ctx.ui.confirm("SSH-Key laden?", clean(key.path), { signal }))) return "Entsperren abgebrochen.";
		} else {
			const keys = await discoverKeys();
			const status = await agent.status();
			const labels = keys.map((key, index) => `${index + 1}. ${clean(key.path)}${fingerprintOf(key) && status.keys.some((line) => line.split(/\s+/).includes(fingerprintOf(key)!)) ? " [geladen]" : ""}`);
			const other = "Anderen Key-Pfad eingeben …";
			const choice = await ctx.ui.select("Privaten SSH-Key auswählen", [...labels, other], { signal });
			if (!choice) return "Entsperren abgebrochen.";
			if (choice === other) {
				const input = await ctx.ui.input("Privater SSH-Key: Dateipfad (keine Passphrase)", "~/.ssh/…", { signal });
				if (!input) return "Entsperren abgebrochen.";
				key = await inspectKey(input);
			} else key = keys[labels.indexOf(choice)];
		}
		if (!key || signal?.aborted) throw new Error("Entsperren abgebrochen.");
		await agent.ensure();
		const status = await agent.status();
		const fingerprint = fingerprintOf(key);
		if (fingerprint && status.keys.some((line) => line.split(/\s+/).includes(fingerprint))) return "SSH-Key ist bereits im Agent geladen.";
		await addKey(key, (attempt, askSignal) => passphrase(ctx, attempt, askSignal), signal);
		const added = (await agent.status()).keys.filter((line) => !status.keys.includes(line));
		const identity = added.length === 1 ? added[0].match(/SHA256:[A-Za-z0-9+/]+/)?.[0] : undefined;
		if (identity) unlocked.set(key.revision, identity);
		return "SSH-Key im Agent geladen. Das bestätigt keine Server-Authentifizierung.";
	}

	async function unlock(ctx: ExtensionContext, path?: string, signal?: AbortSignal): Promise<string> {
		if (busy) throw new Error("Eine SSH-Key-Operation läuft bereits.");
		busy = true;
		operation = new AbortController();
		const active = operation;
		const abort = () => active.abort();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		await refresh(ctx);
		pending = performUnlock(ctx, path, active.signal);
		try { return await pending; }
		finally {
			signal?.removeEventListener("abort", abort);
			pending = undefined; operation = undefined; busy = false;
			await refresh(ctx);
		}
	}

	function report(ctx: ExtensionContext, text: string, error = false) {
		if (ctx.hasUI) ctx.ui.notify(text, error ? "error" : "info");
	}
	// Never relay raw OpenSSH output or unknown exceptions into notifications/tool results.
	const errorMessage = (error: unknown) => error instanceof Error && /^(?:SSH-|Key |Kein |OpenSSH-|Zeitlimit |Vorgang |Entsperren |Entsperrung |Eine |Sichere |Geladene |Ungültiger )/.test(error.message) ? clean(error.message) : "SSH-Operation fehlgeschlagen. Key-Pfad, Rechte und OpenSSH-Installation prüfen.";

	// Native ssh must fail promptly instead of bypassing the secure Pi dialog via /dev/tty.
	// Use the official bash factory; tool_call/tool_result still run normally, including nested calls.
	pi.registerTool({
		...createBashTool(process.cwd()),
		async execute(id, params, signal, update, ctx) {
			const bash = createBashTool(ctx.cwd, {
				spawnHook: ({ command, cwd, env }) => ({ command, cwd, env: {
					...env, SSH_ASKPASS: "/usr/bin/false", SSH_ASKPASS_REQUIRE: "force", DISPLAY: env.DISPLAY || "pi-ssh:0",
				} }),
			});
			return bash.execute(id, params, signal, update);
		},
	});

	pi.registerTool({
		name: "ssh_unlock", label: "SSH-Key entsperren",
		description: "Select and unlock an SSH private key using a secure local masked dialog. Never request or provide a passphrase in chat or arguments. Requires local TUI. Loading a key does not prove server authorization. Never automatically repeat a failed push, pull, clone or remote SSH command; obtain user approval first.",
		parameters: Type.Object({ keyPath: Type.Optional(Type.String({ description: "Optional private key file path, never a passphrase. Omit to let the user select." })) }),
		async execute(_id, params, signal, _update, ctx) {
			try { return { content: [{ type: "text", text: await unlock(ctx, params.keyPath, signal) }], details: undefined }; }
			catch (error) { throw new Error(errorMessage(error)); }
		},
	});

	pi.registerCommand("ssh-unlock", {
		description: "SSH-Key sicher auswählen und entsperren (optional: Pfad)",
		handler: async (args, ctx) => {
			try { report(ctx, await unlock(ctx, args.trim() || undefined)); }
			catch (error) { report(ctx, errorMessage(error), true); }
		},
	});
	pi.registerCommand("ssh-status", {
		description: "SSH-Agent und geladene Keys/Fingerprints anzeigen",
		handler: async (_args, ctx) => {
			const status = await agent.status();
			report(ctx, !status.available ? "Kein erreichbarer SSH-Agent." : status.keys.length ? `Geladene SSH-Keys (keine Aussage über Serverzugriff):\n${status.keys.join("\n")}` : "SSH-Agent erreichbar, kein Key geladen.");
			await refresh(ctx);
		},
	});
	pi.registerCommand("ssh-keys", {
		description: "Verfügbare private SSH-Keys anzeigen (keine Inhalte)",
		handler: async (_args, ctx) => {
			try {
				const keys = await discoverKeys();
				report(ctx, keys.length ? keys.map((key) => `${clean(key.path)} — ${key.fingerprint ?? "Fingerprint nicht verfügbar"}`).join("\n") : "Keine sicher lesbaren privaten SSH-Keys gefunden. Freien Pfad mit /ssh-unlock wählen.");
			} catch (error) { report(ctx, errorMessage(error), true); }
		},
	});
	pi.registerCommand("ssh-lock", {
		description: "Einen ausgewählten Key aus dem Agent entfernen (für alle Agent-Nutzer)",
		handler: async (_args, ctx) => {
			if (!interactive(ctx)) return report(ctx, "SSH-Key-Auswahl benötigt die lokale Pi-TUI.", true);
			if (busy) return report(ctx, "Eine SSH-Key-Operation läuft bereits.", true);
			busy = true;
			try {
				const status = await agent.status();
				if (!status.keys.length) return report(ctx, "Keine geladenen Keys.");
				const choice = await ctx.ui.select("Key aus SSH-Agent entfernen", status.keys);
				if (choice && await ctx.ui.confirm("Key entfernen?", "Der Key wird auch für andere Prozesse entfernt, die diesen Agenten verwenden.")) {
					await removeKey(choice); report(ctx, "SSH-Key aus dem Agent entfernt.");
				}
			} catch (error) { report(ctx, errorMessage(error), true); }
			finally { busy = false; await refresh(ctx); }
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		context = ctx;
		await refresh(ctx);
		if (poll) clearInterval(poll);
		poll = setInterval(() => { void refresh().catch(() => {}); }, 5000);
		poll.unref();
	});
	pi.on("agent_start", () => { autoOffered = false; });
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash" || typeof event.input.command !== "string") return;
		const command = event.input.command;
		if (failedCommands.has(command)) {
			if (!interactive(ctx) || !(await ctx.ui.confirm("Fehlgeschlagenen Befehl erneut ausführen?", "Ein SSH-Authentifizierungsfehler ist aufgetreten. Vor Wiederholung mögliche Teiländerungen prüfen. Befehl:\n" + clean(command), { signal: ctx.signal }))) {
				return { block: true, reason: "Wiederholung nach SSH-Fehler benötigt ausdrückliche Benutzerfreigabe." };
			}
			failedCommands.delete(command);
		}
		// Preflight only obvious SSH transports, never HTTPS or compound shell commands.
		if (!interactive(ctx) || autoOffered || busy || !sshCommand(command)) return;
		let sshTransport = /(?:^\s*ssh\s|ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(command);
		if (!sshTransport && /^git\s+(?:fetch|pull|push)\b/.test(command.trim())) {
			try {
				const remote = await run("/usr/bin/git", ["-C", ctx.cwd, "config", "--get", "remote.origin.url"]);
				sshTransport = /^(?:ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(remote.stdout.trim());
			} catch { /* The post-result hook handles other transports/remotes without guessing. */ }
		}
		if (!sshTransport) return;
		const status = await agent.status();
		if (status.keys.length) return;
		autoOffered = true;
		if (!(await ctx.ui.confirm("SSH-Key vorab laden?", "Kein Key im erreichbaren Agent. Einen Key vor dem Befehl sicher entsperren?", { signal: ctx.signal }))) return;
		try { report(ctx, await unlock(ctx, undefined, ctx.signal)); }
		catch (error) { return { block: true, reason: errorMessage(error) }; }
	});
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash" || !event.isError || typeof event.input.command !== "string") return;
		const output = event.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
		if (!publicKeyFailure(output)) return;
		// Gate model-issued retries even when this is a compound/unsupported shell command.
		failedCommands.add(event.input.command);
		if (failedCommands.size > 100) failedCommands.delete(failedCommands.values().next().value!);
		if (!interactive(ctx) || autoOffered || busy || !sshCommand(event.input.command)) return;
		autoOffered = true;
		if (!(await ctx.ui.confirm("SSH: Public-Key-Authentifizierung abgelehnt", "Das kann auch fehlende Serverberechtigung, falschen Benutzer oder falschen Key bedeuten. Einen lokalen Key auswählen und laden? Der Befehl wird nicht automatisch wiederholt.", { signal: ctx.signal }))) return;
		let message: string;
		try { message = await unlock(ctx, undefined, ctx.signal); }
		catch (error) { message = errorMessage(error); }
		return { content: [...event.content, { type: "text", text: `${message} Ursprünglicher Befehl nicht wiederholt. Eine Wiederholung erfordert Benutzerfreigabe.` }] };
	});
	pi.on("session_shutdown", async () => {
		if (poll) clearInterval(poll);
		poll = undefined;
		operation?.abort();
		await pending?.catch(() => {});
		await agent.close();
		context?.ui.setStatus("ssh-agent", undefined);
		context = undefined;
		agent = new Agent();
		failedCommands.clear(); unlocked.clear(); autoOffered = false;
	});
}
