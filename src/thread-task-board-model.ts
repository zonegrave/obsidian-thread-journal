import { parseTaskLine, taskStatusMarker, taskWindowState, taskIsScheduledToday, taskNeedsPinnedAttention, type TaskData } from './task-model';

export type BoardTaskStatus = 'open' | 'committed' | 'idea';
export type BoardGroup = 'review' | 'current' | 'holding';

interface BoardSortItem {
	task: {
		data: Pick<TaskData, 'windowEnd' | 'windowStart' | 'scheduled'>;
		text: string;
	};
	thread: { title: string };
}

export function compareBoardTasks(left: BoardSortItem, right: BoardSortItem): number {
	const leftEnd = left.task.data.windowEnd;
	const rightEnd = right.task.data.windowEnd;
	if (Boolean(leftEnd) !== Boolean(rightEnd)) return leftEnd ? -1 : 1;
	const leftDate = leftEnd || left.task.data.windowStart || left.task.data.scheduled || '9999-99-99';
	const rightDate = rightEnd || right.task.data.windowStart || right.task.data.scheduled || '9999-99-99';
	return leftDate.localeCompare(rightDate)
		|| (left.task.data.scheduled && right.task.data.scheduled ? left.task.data.scheduled.localeCompare(right.task.data.scheduled) : 0)
		|| left.task.text.localeCompare(right.task.text)
		|| left.thread.title.localeCompare(right.thread.title);
}

export function groupBoardTasks<T extends BoardSortItem & {
	task: { data: Pick<TaskData, 'holding' | 'holdingReview'> };
}>(tasks: readonly T[], today: string): Record<BoardGroup, T[]> {
	const grouped: Record<BoardGroup, T[]> = { review: [], current: [], holding: [] };
	for (const item of [...tasks].sort(compareBoardTasks)) {
		const { data } = item.task;
		if (!data.holding) grouped.current.push(item);
		else if (data.holdingReview && data.holdingReview <= today) grouped.review.push(item);
		else grouped.holding.push(item);
	}
	return grouped;
}

export function taskLineWithBoardStatus(line: string, status: BoardTaskStatus): string | undefined {
	const parsed = parseTaskLine(line);
	if (!parsed || !['open', 'committed', 'idea'].includes(parsed.data.status)) return undefined;
	return parsed.prefix + taskStatusMarker(status) + line.slice(parsed.prefix.length + 1);
}

export function taskIsActiveOnBoard(data: TaskData, today: string): boolean {
	if (!['open', 'committed', 'idea'].includes(data.status)) return false;
	if (data.scheduled) return taskIsScheduledToday(data, today);
	if (taskNeedsPinnedAttention(data)) return true;
	return taskWindowState(data, today.slice(0, 10)) !== 'upcoming';
}

export function boardTaskLane(data: TaskData, today: string): 'pinned' | 'scheduled' | 'decision' | undefined {
	if (!taskIsActiveOnBoard(data, today)) return undefined;
	if (data.scheduled) return 'scheduled';
	return taskNeedsPinnedAttention(data) ? 'pinned' : 'decision';
}
