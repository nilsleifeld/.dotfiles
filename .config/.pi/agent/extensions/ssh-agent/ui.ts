import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, decodeKittyPrintable, isKeyRelease, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Secret } from "./secret.ts";

export function passphrase(ctx: ExtensionContext, attempt: number, signal: AbortSignal): Promise<Buffer | undefined> {
	if (!ctx.hasUI || ctx.mode !== "tui") throw new Error("Sichere Passphrase-Eingabe benötigt die lokale Pi-TUI (kein RPC/Print/JSON).");
	return ctx.ui.custom<Buffer | undefined>((tui, theme, _kb, done) => {
		const secret = new Secret();
		let finished = false;
		const finish = (value?: Buffer) => {
			if (finished) { value?.fill(0); return; }
			finished = true; secret.clear(); done(value);
		};
		const cancel = () => finish();
		const timer = setTimeout(cancel, 120000);
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) queueMicrotask(cancel);
		return {
			focused: true,
			render: (width: number) => [
				truncateToWidth(theme.fg("accent", attempt > 1 ? `SSH: Passphrase erneut eingeben (Versuch ${attempt}/3)` : "SSH: Passphrase eingeben"), width),
				truncateToWidth("> " + secret.mask + CURSOR_MARKER, width),
				truncateToWidth(theme.fg("dim", "Enter: laden · Esc/Ctrl-C: abbrechen · Ctrl-U: löschen"), width),
			],
			handleInput(data: string) {
				if (finished || isKeyRelease(data)) return;
				if (secret.inputPaste(data)) { tui.requestRender(); return; }
				if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) finish();
				else if (matchesKey(data, "enter")) finish(secret.take());
				else if (matchesKey(data, "backspace")) secret.backspace();
				else if (matchesKey(data, "ctrl+u")) secret.clear();
				else secret.append(decodeKittyPrintable(data) ?? data);
				tui.requestRender();
			},
			invalidate() {},
			dispose() { clearTimeout(timer); signal.removeEventListener("abort", cancel); secret.clear(); },
		};
	});
}
