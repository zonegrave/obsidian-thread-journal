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
}

const INLINE_LOG_FIELD = /(?:\[thread_log::\s*([^\]]+)\]|\(thread_log::\s*([^)]+)\))/u;

export function parseInlineLogEntries(content: string): ParsedInlineLogEntry[] {
	const entries: ParsedInlineLogEntry[] = [];
	for (const line of content.split('\n')) {
		const unquoted = line.replace(/^\s*(?:>\s*)+/u, '').trimStart();
		if (!/^[-*+]\s+/u.test(unquoted)) continue;
		const match = INLINE_LOG_FIELD.exec(unquoted);
		if (!match) continue;
		const timestamp = (match[1] ?? match[2] ?? '').trim();
		const date = /^(\d{4}-\d{2}-\d{2})/u.exec(timestamp)?.[1];
		if (!date) continue;
		const time = /[T ](\d{2}:\d{2})(?::\d{2})?/u.exec(timestamp)?.[1] ?? '';
		entries.push({
			timestamp,
			date,
			time,
			text: unquoted.slice((match.index ?? 0) + match[0].length).trim(),
		});
	}
	return entries;
}

export function inlineLogEntriesForDate(
	content: string,
	date: string,
): ParsedInlineLogEntry[] {
	return parseInlineLogEntries(content)
		.filter((entry) => entry.date === date)
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function buildInlineLogEdit(
	line: string,
	displayTimestamp: string,
	storedTimestamp: string,
): InlineLogEdit {
	const indentation = /^\s*/u.exec(line)?.[0] ?? '';
	const title = `${indentation}> [!thread-log] 进度 · ${displayTimestamp}`;
	const body = `${indentation}> - (thread_log:: ${storedTimestamp}) `;
	const callout = `${title}\n${body}`;
	if (!line.trim()) {
		return {
			replacement: callout,
			fromCh: 0,
			toCh: line.length,
			cursorLineOffset: 1,
			cursorCh: body.length,
		};
	}
	return {
		replacement: `\n\n${callout}`,
		fromCh: line.length,
		toCh: line.length,
		cursorLineOffset: 3,
		cursorCh: body.length,
	};
}
