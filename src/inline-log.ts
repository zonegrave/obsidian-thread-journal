export interface InlineLogEdit {
	replacement: string;
	fromCh: number;
	toCh: number;
	cursorLineOffset: number;
	cursorCh: number;
}

export interface ParsedInlineLogEntry {
	timestamp: string;
	date: string;
	time: string;
	text: string;
	blockId: string;
}

const LOG_CALLOUT_HEADER = /^\s*>\s*\[!thread-log\].*$/u;
const LOG_METADATA = /\(thread_log::\s*([^)]+)\)/u;
const BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/u;
const BLOCK_ID_LINE = /^\s*\^([A-Za-z0-9_-]+)\s*$/u;

function unquote(line: string): string {
	return line.replace(/^\s*>\s?/u, '');
}

function parseCalloutBody(lines: string[], footerBlockId?: string): ParsedInlineLogEntry | undefined {
	let timestamp = '';
	let blockId = footerBlockId ?? '';
	const body: string[] = [];
	for (const [index, source] of lines.entries()) {
		let line = unquote(source);
		const metadata = !timestamp ? LOG_METADATA.exec(line) : null;
		if (metadata) {
			timestamp = (metadata[1] ?? '').trim();
			const metadataStart = metadata.index;
			line = line.slice(0, metadataStart) + line.slice(metadataStart + metadata[0].length);
			// A list marker wrapping the data field is not part of the log body.
			if (/^\s*[-*+]\s*$/u.test(line.slice(0, metadataStart))) {
				line = line.replace(/^\s*[-*+]\s*/u, '');
			}
		}
		const inlineBlockId = metadata || (!blockId && index === lines.length - 1)
			? BLOCK_ID.exec(line)
			: null;
		if (inlineBlockId) {
			if (!blockId) blockId = inlineBlockId[1] ?? '';
			line = line.slice(0, inlineBlockId.index).trimEnd();
		}
		body.push(metadata || inlineBlockId ? line.trim() : line);
	}
	const date = /^(\d{4}-\d{2}-\d{2})/u.exec(timestamp)?.[1];
	if (!date) return undefined;
	const time = /[T ](\d{2}:\d{2})(?::\d{2})?/u.exec(timestamp)?.[1] ?? '';
	while (body.length > 0 && !body[0]?.trim()) body.shift();
	while (body.length > 0 && !body[body.length - 1]?.trim()) body.pop();
	return { timestamp, date, time, text: body.join('\n'), blockId };
}

export function parseInlineLogEntrySlots(content: string): Array<ParsedInlineLogEntry | undefined> {
	const slots: Array<ParsedInlineLogEntry | undefined> = [];
	const lines = content.split(/\r?\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		if (!LOG_CALLOUT_HEADER.test(lines[index] ?? '')) continue;
		const start = index;
		let end = start + 1;
		while (
			end < lines.length
			&& /^\s*>/u.test(lines[end] ?? '')
			&& !/^\s*>\s*\[!/u.test(lines[end] ?? '')
		) end += 1;
		// Some existing logs use a block ID after the callout. Read it without
		// requiring the title, timestamp, and ID to occupy particular lines.
		const footerLine = !lines[end]?.trim() && BLOCK_ID_LINE.test(lines[end + 1] ?? '')
			? end + 1
			: end;
		const footerBlockId = BLOCK_ID_LINE.exec(lines[footerLine] ?? '')?.[1];
		slots.push(parseCalloutBody(lines.slice(start + 1, end), footerBlockId));
		index = footerLine > end ? footerLine : end - 1;
	}
	return slots;
}

export function parseInlineLogEntries(content: string): ParsedInlineLogEntry[] {
	return parseInlineLogEntrySlots(content).filter(
		(entry): entry is ParsedInlineLogEntry => entry !== undefined,
	);
}

export function inlineLogEntryAroundLine(
	content: string,
	line: number,
): ParsedInlineLogEntry | undefined {
	const lines = content.split(/\r?\n/);
	let start = Math.max(0, Math.min(Math.trunc(line), Math.max(0, lines.length - 1)));
	for (; start >= 0; start -= 1) {
		const source = lines[start] ?? '';
		if (LOG_CALLOUT_HEADER.test(source)) break;
		if (!/^\s*>/u.test(source)) return undefined;
	}
	if (start < 0) return undefined;
	return parseInlineLogEntrySlots(lines.slice(start).join('\n'))[0];
}

export function buildInlineLogEdit(
	line: string,
	cursorCh: number,
	storedTimestamp: string,
	blockId: string,
): InlineLogEdit {
	const indentation = /^\s*/u.exec(line)?.[0] ?? '';
	const title = `${indentation}> [!thread-log]`;
	const safeBlockId = blockId.replace(/[^A-Za-z0-9-]+/gu, '-');
	const metadataPrefix = `${indentation}> - (thread_log:: ${storedTimestamp}) `;
	const callout = `${title}\n${metadataPrefix} ^${safeBlockId}`;
	if (!line.trim()) {
		return {
			replacement: `${callout}\n`,
			fromCh: 0,
			toCh: line.length,
			cursorLineOffset: 1,
			cursorCh: metadataPrefix.length,
		};
	}
	const position = Math.max(0, Math.min(Math.trunc(cursorCh), line.length));
	const before = position > 0 ? '\n\n' : '';
	const after = position < line.length ? '\n\n' : '\n';
	return {
		replacement: `${before}${callout}${after}`,
		fromCh: position,
		toCh: position,
		cursorLineOffset: position > 0 ? 3 : 1,
		cursorCh: metadataPrefix.length,
	};
}
