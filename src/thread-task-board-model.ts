import { taskWindowState, type TaskData } from './task-model';

export function taskIsActiveOnBoard(data: TaskData, today: string): boolean {
	if (!['open', 'committed', 'idea'].includes(data.status)) return false;
	const window = taskWindowState(data, today);
	if (window === 'upcoming') return false;
	if (data.repeat) return Boolean(data.current && data.current <= today);
	return true;
}
