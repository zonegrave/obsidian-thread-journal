import { taskNeedsPinnedAttention, type TaskData, type TaskStatus } from './task-model';
import { compareBoardTasks } from './thread-task-board-model';

interface ExplorerSortItem {
	task: { data: TaskData; text: string };
	thread: { title: string };
}
const STATUS_ORDER: Record<TaskStatus, number> = { open: 1, committed: 2, idea: 3, cancelled: 4, completed: 5 };

// Pin is a priority within Open, rather than a second copy of the same task.
export function compareExplorerTasks(left: ExplorerSortItem, right: ExplorerSortItem): number {
	const rank = (data: TaskData): number => taskNeedsPinnedAttention(data) ? 0 : STATUS_ORDER[data.status];
	return rank(left.task.data) - rank(right.task.data) || compareBoardTasks(left, right);
}
