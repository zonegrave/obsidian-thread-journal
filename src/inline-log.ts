export interface InlineLogEdit {
	replacement: string;
	fromCh: number;
	toCh: number;
	cursorLineOffset: number;
	cursorCh: number;
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
