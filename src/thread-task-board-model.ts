import { parseTaskLine, taskStatusMarker, taskWindowState, type TaskData } from './task-model';

export type BoardTaskStatus = 'open' | 'committed' | 'idea';

export function taskLineWithBoardStatus(line: string, status: BoardTaskStatus): string | undefined {
	const parsed = parseTaskLine(line);
	if (!parsed || !['open', 'committed', 'idea'].includes(parsed.data.status)) return undefined;
	return parsed.prefix + taskStatusMarker(status) + line.slice(parsed.prefix.length + 1);
}

export function taskIsActiveOnBoard(data: TaskData, today: string): boolean {
	if (!['open', 'committed', 'idea'].includes(data.status)) return false;
	const window = taskWindowState(data, today);
	if (window === 'upcoming') return false;
	if (data.repeat) return Boolean(data.current && data.current <= today);
	return true;
}
