import { parseTaskLine, taskStatusMarker, taskWindowState, type TaskData } from './task-model';

export type BoardTaskStatus = 'open' | 'committed' | 'idea';

interface BoardSortItem {
	task: {
		data: Pick<TaskData, 'windowEnd' | 'windowStart' | 'current'>;
		text: string;
	};
	thread: { title: string };
}

export function compareBoardTasks(left: BoardSortItem, right: BoardSortItem): number {
	const leftEnd = left.task.data.windowEnd;
	const rightEnd = right.task.data.windowEnd;
	if (Boolean(leftEnd) !== Boolean(rightEnd)) return leftEnd ? -1 : 1;
	const leftDate = leftEnd || left.task.data.windowStart || left.task.data.current || '9999-99-99';
	const rightDate = rightEnd || right.task.data.windowStart || right.task.data.current || '9999-99-99';
	return leftDate.localeCompare(rightDate)
		|| left.task.text.localeCompare(right.task.text)
		|| left.thread.title.localeCompare(right.thread.title);
}

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
