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

const LOG_CALLOUT_TITLE = /^\s*>\s*\[!thread-log\]\s*$/u;
const LOG_CALLOUT_HEADER = /^\s*>\s*\[!thread-log\](?:\s+.*)?$/u;
const LOG_METADATA = /^\s*\(thread_log::\s*([^)]+)\)\s+\^([\p{Letter}\p{Number}_-]+)\s*$/u;

function unquote(line: string): string {
	return line.replace(/^\s*>\s?/u, '');
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
		const match = LOG_CALLOUT_TITLE.test(lines[start] ?? '') && end > start + 1
			? LOG_METADATA.exec(unquote(lines[start + 1] ?? ''))
			: null;
		index = end - 1;
		if (!match) {
			slots.push(undefined);
			continue;
		}
		const timestamp = (match[1] ?? '').trim();
		const date = /^(\d{4}-\d{2}-\d{2})/u.exec(timestamp)?.[1];
		if (!date) {
			slots.push(undefined);
			continue;
		}
		const time = /[T ](\d{2}:\d{2})(?::\d{2})?/u.exec(timestamp)?.[1] ?? '';
		const body = lines.slice(start + 2, end).map(unquote);
		while (body.length > 0 && !body[0]?.trim()) body.shift();
		while (body.length > 0 && !body[body.length - 1]?.trim()) body.pop();
		slots.push({
			timestamp,
			date,
			time,
			text: body.join('\n'),
			blockId: match[2] ?? '',
		});
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
		if (LOG_CALLOUT_TITLE.test(source)) break;
		if (!/^\s*>/u.test(source)) return undefined;
	}
	if (start < 0) return undefined;
	let end = start + 1;
	while (end < lines.length && /^\s*>/u.test(lines[end] ?? '')) end += 1;
	return parseInlineLogEntries(lines.slice(start, end).join('\n'))[0];
}

export function buildInlineLogEdit(
	line: string,
	storedTimestamp: string,
	blockId: string,
): InlineLogEdit {
	const indentation = /^\s*/u.exec(line)?.[0] ?? '';
	const title = `${indentation}> [!thread-log]`;
	const safeBlockId = blockId.replace(/[^\p{Letter}\p{Number}_-]+/gu, '-');
	const metadata = `${indentation}> (thread_log:: ${storedTimestamp}) ^${safeBlockId}`;
	const bodyPrefix = `${indentation}> `;
	const callout = `${title}\n${metadata}\n${bodyPrefix}\n${bodyPrefix}`;
	if (!line.trim()) {
		return {
			replacement: callout,
			fromCh: 0,
			toCh: line.length,
			cursorLineOffset: 3,
			cursorCh: bodyPrefix.length,
		};
	}
	return {
		replacement: `\n\n${callout}`,
		fromCh: line.length,
		toCh: line.length,
		cursorLineOffset: 5,
		cursorCh: bodyPrefix.length,
	};
}
