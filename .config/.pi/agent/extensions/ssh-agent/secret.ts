// No Input/Editor: their undo/kill-ring state must never retain passphrases.
export class Secret {
	private data = Buffer.alloc(16384);
	private length = 0;
	private paste = false;
	private pasted = "";

	append(text: string): void {
		if (/[\x00-\x1f\x7f-\x9f]/.test(text)) return;
		const bytes = Buffer.from(text, "utf8");
		if (this.length + bytes.length <= this.data.length) {
			bytes.copy(this.data, this.length); this.length += bytes.length;
		}
		bytes.fill(0);
	}
	inputPaste(text: string): boolean {
		if (text.startsWith("\x1b[200~")) { this.paste = true; this.pasted = ""; text = text.slice(6); }
		if (!this.paste) return false;
		this.pasted += text;
		if (this.pasted.length > 32768) { this.clear(); return true; }
		const end = this.pasted.indexOf("\x1b[201~");
		if (end >= 0) {
			// Reject multiline pastes instead of accidentally submitting a partial secret.
			this.append(this.pasted.slice(0, end));
			this.pasted = ""; this.paste = false;
		}
		return true;
	}
	backspace(): void {
		if (!this.length) return;
		let start = this.length - 1;
		while (start > 0 && (this.data[start] & 0xc0) === 0x80) start--;
		this.data.fill(0, start, this.length); this.length = start;
	}
	take(): Buffer {
		const result = Buffer.from(this.data.subarray(0, this.length));
		this.clear(); return result;
	}
	clear(): void { this.data.fill(0); this.length = 0; this.paste = false; this.pasted = ""; }
	get mask(): string { return this.length ? "••••••••" : ""; }
}
