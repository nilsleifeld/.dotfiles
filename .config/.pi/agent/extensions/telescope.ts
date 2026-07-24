import { spawn } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Key,
	decodeKittyPrintable,
	isKeyRelease,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";

const MAX_FILES = 50_000;
const MAX_PREVIEW_BYTES = 128 * 1024;
const MAX_PREVIEW_LINES = 500;

function padToWidth(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(0, width), "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function discoverFiles(cwd: string): Promise<string[]> {
	return new Promise((resolveFiles) => {
		const child = spawn(
			"fd",
			[
				"--type",
				"f",
				"--type",
				"d",
				"--hidden",
				"--exclude",
				".git",
				"--color",
				"never",
				"--max-results",
				String(MAX_FILES),
				".",
			],
			{ cwd, stdio: ["ignore", "pipe", "ignore"] },
		);

		let stdout = "";
		let settled = false;
		const finish = (files: string[]) => {
			if (settled) return;
			settled = true;
			resolveFiles(files);
		};

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", () => finish([]));
		child.on("close", (code) => {
			if (code !== 0) return finish([]);
			finish(
				stdout
					.split("\n")
					.map((file) => file.trim().replaceAll("\\", "/"))
					.filter(Boolean),
			);
		});
	});
}

async function readPreview(cwd: string, relativePath: string): Promise<string[]> {
	const absolutePath = resolve(cwd, relativePath);
	let file;
	try {
		if (relativePath.endsWith("/")) {
			const entries = await readdir(absolutePath, { withFileTypes: true });
			return entries
				.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
				.slice(0, MAX_PREVIEW_LINES)
				.map((entry) => `${entry.isDirectory() ? "▸ " : "  "}${entry.name}${entry.isDirectory() ? "/" : ""}`);
		}

		file = await open(absolutePath, "r");
		const buffer = Buffer.alloc(MAX_PREVIEW_BYTES);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		const content = buffer.subarray(0, bytesRead);

		if (content.includes(0)) {
			return ["Binary file", "", `${bytesRead.toLocaleString()} bytes sampled`];
		}

		const text = content.toString("utf8");
		const lines = text.split("\n").slice(0, MAX_PREVIEW_LINES);
		if (bytesRead === MAX_PREVIEW_BYTES) {
			lines.push("", `… preview truncated after ${MAX_PREVIEW_BYTES / 1024} KiB`);
		}
		return lines;
	} catch (error) {
		return [`Preview unavailable: ${error instanceof Error ? error.message : String(error)}`];
	} finally {
		await file?.close().catch(() => undefined);
	}
}

function formatAttachment(path: string): string {
	if (/\s|"/.test(path)) {
		return `@"${path.replaceAll('"', '\\"')}" `;
	}
	return `@${path} `;
}

class TelescopePicker implements Component, Focusable {
	focused = false;

	private files: string[];
	private matches: string[];
	private mode: "normal" | "insert" = "insert";
	private query = "";
	private queryCursor = 0;
	private selected = 0;
	private filterRequest = 0;
	private previewRequest = 0;
	private filterProcess?: ReturnType<typeof spawn>;
	private previewVisible = false;
	private preview: string[] = ["Select a file to preview"];
	private disposed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly cwd: string,
		files: string[],
		private readonly done: (path: string | undefined) => void,
	) {
		this.files = files;
		this.matches = files;
	}

	setFiles(files: string[]): void {
		if (this.disposed) return;
		this.files = files;
		this.runFilter();
	}

	private currentFile(): string | undefined {
		return this.matches[this.selected];
	}

	private moveSelection(delta: number): void {
		if (this.matches.length === 0) return;
		this.selected = Math.max(0, Math.min(this.matches.length - 1, this.selected + delta));
		if (this.previewVisible) void this.updatePreview();
		this.tui.requestRender();
	}

	private async updatePreview(): Promise<void> {
		const path = this.currentFile();
		const request = ++this.previewRequest;
		this.preview = path ? ["Loading preview…"] : ["No matching files"];
		this.tui.requestRender();
		if (!path) return;

		const preview = await readPreview(this.cwd, path);
		if (this.disposed || request !== this.previewRequest) return;
		this.preview = preview;
		this.tui.requestRender();
	}

	private runFilter(): void {
		const request = ++this.filterRequest;
		this.filterProcess?.kill("SIGKILL");
		this.filterProcess = undefined;

		if (!this.query) {
			this.matches = this.files;
			this.selected = 0;
			if (this.previewVisible) void this.updatePreview();
			this.tui.requestRender();
			return;
		}

		this.tui.requestRender();
		const child = spawn(
			"fzf",
			[
				`--filter=${this.query}`,
				"--scheme=path",
				"--no-color",
				"--tiebreak=begin,length,index",
			],
			{ cwd: this.cwd, stdio: ["pipe", "pipe", "ignore"] },
		);
		this.filterProcess = child;

		let stdout = "";
		let failed = false;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", () => {
			failed = true;
		});
		child.on("close", () => {
			if (this.disposed || request !== this.filterRequest) return;
			this.filterProcess = undefined;
			this.matches = failed ? [] : stdout.split("\n").filter(Boolean);
			this.selected = 0;
			if (this.previewVisible) void this.updatePreview();
			this.tui.requestRender();
		});
		child.stdin.on("error", () => undefined);
		child.stdin.end(`${this.files.join("\n")}\n`);
	}

	private insertQuery(text: string): void {
		if (!text) return;
		this.query = this.query.slice(0, this.queryCursor) + text + this.query.slice(this.queryCursor);
		this.queryCursor += text.length;
		this.runFilter();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			if (this.mode === "insert") {
				this.mode = "normal";
				this.tui.requestRender();
			} else {
				this.done(undefined);
			}
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const path = this.currentFile();
			if (path) this.done(path);
			return;
		}

		if (this.mode === "normal") {
			if (matchesKey(data, "i")) {
				this.mode = "insert";
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "q")) {
				this.done(undefined);
				return;
			}
			if (matchesKey(data, "p")) {
				this.previewVisible = !this.previewVisible;
				if (this.previewVisible) void this.updatePreview();
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "k") || matchesKey(data, Key.up)) {
				this.moveSelection(-1);
				return;
			}
			if (matchesKey(data, "j") || matchesKey(data, Key.down)) {
				this.moveSelection(1);
				return;
			}
			if (matchesKey(data, Key.pageUp)) {
				this.moveSelection(-10);
				return;
			}
			if (matchesKey(data, Key.pageDown)) {
				this.moveSelection(10);
			}
			return;
		}

		if (matchesKey(data, Key.left)) {
			this.queryCursor = Math.max(0, this.queryCursor - 1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.queryCursor = Math.min(this.query.length, this.queryCursor + 1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.home)) {
			this.queryCursor = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.end)) {
			this.queryCursor = this.query.length;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			if (this.queryCursor > 0) {
				this.query = this.query.slice(0, this.queryCursor - 1) + this.query.slice(this.queryCursor);
				this.queryCursor--;
				this.runFilter();
			}
			return;
		}
		if (matchesKey(data, Key.delete)) {
			if (this.queryCursor < this.query.length) {
				this.query = this.query.slice(0, this.queryCursor) + this.query.slice(this.queryCursor + 1);
				this.runFilter();
			}
			return;
		}
		if (matchesKey(data, Key.ctrl("u"))) {
			this.query = "";
			this.queryCursor = 0;
			this.runFilter();
			return;
		}

		const printable = decodeKittyPrintable(data);
		if (printable !== undefined) {
			this.insertQuery(printable);
		} else if (!data.includes("\x1b") && [...data].every((char) => char.codePointAt(0)! >= 32)) {
			this.insertQuery(data);
		}
	}

	private renderQuery(width: number): string {
		const label = this.theme.fg("accent", "> ");
		const position = this.matches.length === 0 ? 0 : this.selected + 1;
		const suffix = this.theme.fg("dim", ` ${position} / ${this.matches.length} files `);
		const available = Math.max(1, width - visibleWidth(label) - visibleWidth(suffix));
		const start = Math.max(0, this.queryCursor - available + 1);
		const shown = this.query.slice(start, start + available);
		let query = shown;

		if (this.mode === "insert") {
			const localCursor = this.queryCursor - start;
			const before = shown.slice(0, localCursor);
			const cursorChar = shown[localCursor] ?? " ";
			const after = shown.slice(localCursor + 1);
			const marker = this.focused ? CURSOR_MARKER : "";
			query = `${before}${marker}${this.theme.inverse(cursorChar)}${after}`;
		}

		return `${label}${padToWidth(query, available)}${suffix}`;
	}

	render(width: number): string[] {
		if (width < 40) {
			return [truncateToWidth(this.theme.fg("warning", "Telescope needs at least 40 columns"), width, "")];
		}
		const innerWidth = width - 2;
		const bodyRows = Math.max(5, Math.min(28, Math.floor(this.tui.terminal.rows * 0.8) - 5));
		const listWidth = this.previewVisible
			? Math.max(18, Math.min(Math.floor(innerWidth * 0.4), innerWidth - 20))
			: innerWidth;
		const previewWidth = this.previewVisible ? Math.max(1, innerWidth - listWidth - 1) : 0;
		const border = (text: string) => this.theme.fg("borderAccent", text);
		const row = (content: string) => border("│") + padToWidth(content, innerWidth) + border("│");
		const topBorder = this.previewVisible
			? `╭${"─".repeat(listWidth)}┬${"─".repeat(previewWidth)}╮`
			: `╭${"─".repeat(innerWidth)}╮`;
		const lines: string[] = [border(topBorder)];

		const maxStart = Math.max(0, this.matches.length - bodyRows);
		const listStart = Math.min(maxStart, Math.max(0, this.selected - Math.floor(bodyRows / 2)));
		const selectedPath = this.currentFile();
		for (let index = 0; index < bodyRows; index++) {
			const matchIndex = listStart + index;
			const path = this.matches[matchIndex];
			let listCell = "";
			if (path) {
				const isSelected = matchIndex === this.selected;
				const text = padToWidth(`${isSelected ? "▸" : " "} ${path}`, listWidth);
				listCell = isSelected
					? this.theme.bg("selectedBg", this.theme.fg("accent", text))
					: this.theme.fg("text", text);
			}
			listCell = padToWidth(listCell, listWidth);

			if (!this.previewVisible) {
				lines.push(`${border("│")}${listCell}${border("│")}`);
				continue;
			}

			let previewCell = "";
			if (index === 0 && selectedPath) {
				previewCell = this.theme.fg("accent", ` ${selectedPath}`);
			} else {
				const previewIndex = index - 1;
				const previewLine = previewIndex >= 0 ? this.preview[previewIndex] : undefined;
				if (previewLine !== undefined) {
					const number = String(previewIndex + 1).padStart(4, " ");
					previewCell = `${this.theme.fg("dim", `${number} │`)} ${this.theme.fg("text", previewLine)}`;
				}
			}
			lines.push(`${border("│")}${listCell}${border("│")}${padToWidth(previewCell, previewWidth)}${border("│")}`);
		}

		const separator = this.previewVisible
			? `├${"─".repeat(listWidth)}┴${"─".repeat(previewWidth)}┤`
			: `├${"─".repeat(innerWidth)}┤`;
		lines.push(border(separator));
		const help =
			this.mode === "normal"
				? ` NORMAL · j/k navigate · i search · p preview ${this.previewVisible ? "off" : "on"} · Enter attach · q cancel`
				: " INSERT · type to search · Esc normal mode · Enter attach · Ctrl-u clear";
		lines.push(row(this.theme.fg("dim", help)));
		lines.push(row(this.renderQuery(innerWidth)));
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {
		this.tui.requestRender();
	}

	dispose(): void {
		this.disposed = true;
		this.filterProcess?.kill("SIGKILL");
	}
}

export default function telescope(pi: ExtensionAPI): void {
	let cachedFiles: string[] = [];
	let pickerActive = false;

	const showTelescope = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" || pickerActive) return;
		pickerActive = true;
		try {
			const refresh = discoverFiles(ctx.cwd);
			if (cachedFiles.length === 0) cachedFiles = await refresh;
			if (cachedFiles.length === 0) {
				ctx.ui.notify("telescope: no files or folders found (is fd installed?)", "warning");
				return;
			}

			let picker: TelescopePicker | undefined;
			const selected = await ctx.ui.custom<string | undefined>(
				(tui, theme, _keybindings, done) => {
					picker = new TelescopePicker(tui, theme, ctx.cwd, cachedFiles, done);
					void refresh.then((files) => {
						if (files.length === 0) return;
						cachedFiles = files;
						picker?.setFiles(files);
					});
					return picker;
				},
				{
					overlay: true,
					overlayOptions: {
						width: "92%",
						maxHeight: "80%",
						anchor: "center",
						margin: 1,
					},
				},
			);

			if (selected) ctx.ui.pasteToEditor(formatAttachment(selected));
		} catch (error) {
			ctx.ui.notify(`telescope: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			pickerActive = false;
		}
	};

	pi.registerCommand("telescope", {
		description: "Open the Telescope file picker",
		handler: async (_args, ctx) => showTelescope(ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const fzf = await pi.exec("fzf", ["--version"], { cwd: ctx.cwd, timeout: 2_000 });
		if (fzf.code !== 0) {
			ctx.ui.notify("telescope requires fzf in PATH", "error");
			return;
		}

		cachedFiles = await discoverFiles(ctx.cwd);
		ctx.ui.onTerminalInput((data) => {
			if (pickerActive || isKeyRelease(data) || !matchesKey(data, Key.at)) return;
			void showTelescope(ctx);
			return { consume: true };
		});
	});
}
