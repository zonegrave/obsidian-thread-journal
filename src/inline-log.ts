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

const INLINE_LOG_FIELD = /\(thread_log::\s*([^)]+)\)/u;

export function parseInlineLogEntries(content: string): ParsedInlineLogEntry[] {
	const entries: ParsedInlineLogEntry[] = [];
	for (const line of content.split('\n')) {
		const unquoted = line.replace(/^\s*(?:>\s*)+/u, '').trimStart();
		if (!/^[-*+]\s+/u.test(unquoted)) continue;
		const match = INLINE_LOG_FIELD.exec(unquoted);
		if (!match) continue;
		const timestamp = (match[1] ?? '').trim();
		const date = /^(\d{4}-\d{2}-\d{2})/u.exec(timestamp)?.[1];
		if (!date) continue;
		const time = /[T ](\d{2}:\d{2})(?::\d{2})?/u.exec(timestamp)?.[1] ?? '';
		const remainder = unquoted.slice((match.index ?? 0) + match[0].length).trim();
		const block = /(?:^|\s)\^([\p{Letter}\p{Number}_-]+)\s*$/u.exec(remainder);
		if (!block?.[1]) continue;
		entries.push({
			timestamp,
			date,
			time,
			text: block ? remainder.slice(0, block.index).trim() : remainder,
			blockId: block[1],
		});
	}
	return entries;
}

export function inlineLogEntryAroundLine(
	content: string,
	line: number,
): ParsedInlineLogEntry | undefined {
	const lines = content.split(/\r?\n/);
	let start = Math.max(0, Math.min(Math.trunc(line), Math.max(0, lines.length - 1)));
	for (; start >= 0; start -= 1) {
		const source = lines[start] ?? '';
		if (/^\s*>\s*\[!thread-log\]/u.test(source)) break;
		if (!/^\s*>/u.test(source)) return undefined;
	}
	if (start < 0) return undefined;
	let end = start + 1;
	while (end < lines.length && /^\s*>/u.test(lines[end] ?? '')) end += 1;
	return parseInlineLogEntries(lines.slice(start, end).join('\n'))[0];
}

export function buildInlineLogEdit(
	line: string,
	displayTimestamp: string,
	storedTimestamp: string,
	blockId: string,
): InlineLogEdit {
	const indentation = /^\s*/u.exec(line)?.[0] ?? '';
	const title = `${indentation}> [!thread-log] ${displayTimestamp}`;
	const bodyPrefix = `${indentation}> - (thread_log:: ${storedTimestamp}) `;
	const safeBlockId = blockId.replace(/[^\p{Letter}\p{Number}_-]+/gu, '-');
	const body = `${bodyPrefix} ^${safeBlockId}`;
	const callout = `${title}\n${body}`;
	if (!line.trim()) {
		return {
			replacement: callout,
			fromCh: 0,
			toCh: line.length,
			cursorLineOffset: 1,
			cursorCh: bodyPrefix.length,
		};
	}
	return {
		replacement: `\n\n${callout}`,
		fromCh: line.length,
		toCh: line.length,
		cursorLineOffset: 3,
		cursorCh: bodyPrefix.length,
	};
}
