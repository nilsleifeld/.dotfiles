import { spawnSync } from "node:child_process";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** A small, deliberately modal Vim layer for Pi's prompt editor. */
class NvimEditor extends CustomEditor {
	private mode: "normal" | "insert" | "visual" | "visual-line" = "insert";
	private pending = "";
	private leader = "";
	private leaderTimer?: ReturnType<typeof setTimeout>;
	private anchor = 0;
	private register = "";

	/** Keep Vim's register in sync with the operating system clipboard. */
	private setRegister(value: string): void {
		this.register = value;
		try {
			if (process.platform === "darwin") {
				spawnSync("pbcopy", [], { input: value, encoding: "utf8" });
			} else if (process.platform === "win32") {
				spawnSync("clip.exe", [], { input: value, encoding: "utf8" });
			} else if (process.env.WAYLAND_DISPLAY) {
				spawnSync("wl-copy", [], { input: value, encoding: "utf8" });
			} else {
				spawnSync("xclip", ["-selection", "clipboard"], { input: value, encoding: "utf8" });
			}
		} catch { /* Keep the internal register working if no clipboard tool exists. */ }
	}

	private readClipboard(): string | undefined {
		try {
			let result;
			if (process.platform === "darwin") {
				result = spawnSync("pbpaste", [], { encoding: "utf8" });
			} else if (process.platform === "win32") {
				result = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" });
			} else if (process.env.WAYLAND_DISPLAY) {
				result = spawnSync("wl-paste", ["--no-newline"], { encoding: "utf8" });
			} else {
				result = spawnSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8" });
			}
			return result.status === 0 ? result.stdout : undefined;
		} catch { return undefined; }
	}

	private absoluteCursor(): number {
		const lines = this.getLines();
		const { line, col } = this.getCursor();
		return lines.slice(0, line).reduce((n, s) => n + s.length + 1, 0) + col;
	}

	private setCursor(position: number): void {
		const text = this.getText();
		const before = text.slice(0, Math.max(0, position));
		const line = before.split("\n").length - 1;
		const col = before.length - (before.lastIndexOf("\n") + 1);
		// Ctrl-A is line start; then move down and right. This uses the editor's
		// public input API, so it also works when the implementation changes.
		super.handleInput("\x01");
		for (let i = 0; i < line; i++) super.handleInput("\x1b[B");
		for (let i = 0; i < col; i++) super.handleInput("\x1b[C");
	}

	private moveBy(delta: number): void {
		const text = this.getText();
		this.setCursor(Math.max(0, Math.min(text.length, this.absoluteCursor() + delta)));
	}

	private wordMove(direction: 1 | -1, end = false): void {
		const text = this.getText();
		let p = this.absoluteCursor();
		if (direction > 0) {
			if (p < text.length && !/\s/.test(text[p]!)) while (p < text.length && !/\s/.test(text[p]!)) p++;
			while (p < text.length && /\s/.test(text[p]!)) p++;
			if (end) while (p + 1 < text.length && !/\s/.test(text[p + 1]!)) p++;
		} else {
			p = Math.max(0, p - 1);
			while (p > 0 && /\s/.test(text[p]!)) p--;
			while (p > 0 && !/\s/.test(text[p - 1]!)) p--;
		}
		this.setCursor(p);
	}

	private editRange(start: number, end: number, replacement = ""): void {
		const text = this.getText();
		this.setRegister(text.slice(start, end));
		this.setText(text.slice(0, start) + replacement + text.slice(end));
		this.setCursor(Math.min(start, this.getText().length));
	}

	private visualRange(): [number, number] {
		let a = this.anchor;
		let b = this.absoluteCursor();
		if (this.mode === "visual-line") {
			const lines = this.getLines();
			const lineStart = (p: number) => {
				let n = 0;
				for (const line of lines) { if (p <= n + line.length) return n; n += line.length + 1; }
				return n;
			};
			const lineEnd = (p: number) => {
				let n = 0;
				for (const line of lines) { if (p <= n + line.length) return n + line.length; n += line.length + 1; }
				return this.getText().length;
			};
			const lo = Math.min(lineStart(a), lineStart(b));
			const hi = Math.max(lineEnd(a), lineEnd(b));
			return [lo, Math.min(this.getText().length, hi + (hi < this.getText().length ? 1 : 0))];
		}
		if (a > b) [a, b] = [b, a];
		return [a, Math.min(this.getText().length, b + 1)];
	}

	private leaveVisual(): void { this.mode = "normal"; this.pending = ""; }

	/** Run one of pi's normal application actions from a leader mapping. */
	private runAction(action: string): void {
		this.actionHandlers.get(action as never)?.();
	}

	/** Submit a slash command without leaving the current Vim mode. */
	private runCommand(command: string): void {
		this.setText(command);
		// `tui.input.submit` is handled by the editor's onSubmit callback,
		// not by CustomEditor's app action map.
		this.onSubmit?.(this.getText());
	}

	private runLeader(key: string): void {
		if (this.leaderTimer) clearTimeout(this.leaderTimer);
		this.leader = "";
		const actions: Record<string, string> = {
			q: "app.exit",
			n: "app.session.new",
			s: "session", // handled as a command below
			m: "app.model.select",
			f: "app.session.fork",
			t: "app.session.tree",
			c: "compact",
		};
		if (key === "n" || key === "s") {
			// Session mappings use two keys: <leader>ns and <leader>ss.
			this.leader = key;
			return;
		}
		if (key === "r") {
			// `leader r` is resume, while `leader rr` is reload.
			this.leader = "r";
			this.leaderTimer = setTimeout(() => {
				this.leader = "";
				this.runCommand("/resume");
			}, 450);
			return;
		}
		if (key === "s") return this.runCommand("/session");
		if (key === "c") return this.runCommand("/compact");
		if (key === "q") {
			// app.exit is a special handler (not part of actionHandlers).
			this.setText("");
			this.onCtrlD?.();
			return;
		}
		const action = actions[key];
		if (action) {
			if (action === "session") this.runCommand("/session");
			else this.runAction(action);
		}
	}

	/** Apply an operator (d/c/y) to the range covered by one motion. */
	private operatorMotion(op: "d" | "c" | "y", key: string): void {
		const start = this.absoluteCursor();
		this.motion(key);
		const end = this.absoluteCursor();
		if (start === end) return;

		const from = Math.min(start, end);
		// Character-wise motions point at the boundary; e and $ include their target.
		const to = Math.max(start, end) + (end > start && (key === "e" || key === "$") ? 1 : 0);
		const cursor = start;
		if (op === "y") {
			this.setRegister(this.getText().slice(from, to));
			this.setCursor(cursor);
		} else {
			this.editRange(from, to);
			if (op === "c") this.mode = "insert";
		}
	}

	private visualAction(key: string): void {
		if (key === "v") { this.mode = "normal"; return; }
		if (key === "y" || key === "d" || key === "x" || key === "c") {
			const [start, end] = this.visualRange();
			const value = this.getText().slice(start, end);
			this.setRegister(value);
			if (key !== "y") this.editRange(start, end, "");
			this.leaveVisual();
			if (key === "c") this.mode = "insert";
			return;
		}
		this.motion(key);
	}

	private motion(key: string): void {
		const motions: Record<string, string> = { h: "\x1b[D", j: "\x1b[B", k: "\x1b[A", l: "\x1b[C", "0": "\x01", "^": "\x01", $: "\x05", G: "\x1b[4;1~" };
		if (key === "w") this.wordMove(1);
		else if (key === "b") this.wordMove(-1);
		else if (key === "e") this.wordMove(1, true);
		else if (key === "%") super.handleInput("\x1b[6~");
		else if (motions[key]) super.handleInput(motions[key]);
		else if (key === "f" || key === "t") this.pending = key;
		else if (key === "H") super.handleInput("\x1b[H");
		else if (key === "L") super.handleInput("\x1b[F");
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			if (this.mode === "insert") this.mode = "normal";
			else if (this.mode === "visual" || this.mode === "visual-line") this.leaveVisual();
			else super.handleInput(data);
			return;
		}
		if (this.mode === "insert") { super.handleInput(data); return; }
		if (this.mode === "visual" || this.mode === "visual-line") { this.visualAction(data); return; }

		// Space is the Vim leader in normal mode.
		if (this.leader === "n" || this.leader === "s") {
			if (data === "s") {
				if (this.leaderTimer) clearTimeout(this.leaderTimer);
				const command = this.leader === "n" ? "app.session.new" : "session";
				this.leader = "";
				return command === "session" ? this.runCommand("/session") : this.runAction(command);
			}
			this.leader = "";
			return;
		}
		if (this.leader === "r") {
			if (data === "r") {
				if (this.leaderTimer) clearTimeout(this.leaderTimer);
				this.leader = "";
				return this.runCommand("/reload");
			}
			return;
		}
		if (this.leader === "") {
			if (data === " ") {
				this.leader = "leader";
				return;
			}
		} else if (this.leader === "leader") {
			return this.runLeader(data);
		}

		if (this.pending === "f" || this.pending === "t") {
			const text = this.getText(); const p = text.indexOf(data, this.absoluteCursor() + 1);
			if (p >= 0) this.setCursor(p + (this.pending === "t" ? -1 : 0));
			this.pending = ""; return;
		}
		if (data === "v") { this.anchor = this.absoluteCursor(); this.mode = "visual"; return; }
		if (data === "V") { this.anchor = this.absoluteCursor(); this.mode = "visual-line"; return; }
		if (data === "i") { this.mode = "insert"; return; }
		if (data === "a") { this.mode = "insert"; this.moveBy(1); return; }
		if (data === "I") { super.handleInput("\x01"); this.mode = "insert"; return; }
		if (data === "A") { super.handleInput("\x05"); this.mode = "insert"; return; }
		if (data === "o" || data === "O") { super.handleInput(data === "o" ? "\r" : "\x01\r\x1b[A"); this.mode = "insert"; return; }
		if (data === "R") { this.mode = "insert"; return; }
		if (data === "p" || data === "P") {
			const value = this.readClipboard() ?? this.register;
			if (value) { if (data === "p") this.moveBy(1); this.insertTextAtCursor(value); }
			return;
		}
		if (data === "u") { super.handleInput("\x1a"); return; }
		if (data === "x") { this.editRange(this.absoluteCursor(), this.absoluteCursor() + 1); return; }
		if (data === "X") { this.editRange(Math.max(0, this.absoluteCursor() - 1), this.absoluteCursor()); return; }
		if (data === "D") { this.editRange(this.absoluteCursor(), this.getText().indexOf("\n", this.absoluteCursor()) < 0 ? this.getText().length : this.getText().indexOf("\n", this.absoluteCursor())); return; }
		if (this.pending) {
			const op = this.pending as "d" | "c" | "y";
			this.pending = "";
			if (data === op) {
				const line = this.getCursor().line;
				const lines = this.getLines();
				const start = lines.slice(0, line).reduce((n, s) => n + s.length + 1, 0);
				const end = start + lines[line]!.length + (line < lines.length - 1 ? 1 : 0);
				if (op === "y") this.setRegister(this.getText().slice(start, end));
				else {
					this.editRange(start, end);
					if (op === "c") this.mode = "insert";
				}
			} else {
				this.operatorMotion(op, data);
			}
			return;
		}
		if (data === "d" || data === "c" || data === "y") { this.pending = data; return; }
		this.motion(data);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (!lines.length) return lines;
		const label = ` ${this.mode.toUpperCase().replace("-", " ")} `;
		const last = lines.length - 1;
		if (visibleWidth(lines[last]!) >= label.length) lines[last] = truncateToWidth(lines[last]!, width - label.length, "") + label;
		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new NvimEditor(tui, theme, keybindings));
	});
}
