import { validDate, taskScheduledDay, taskScheduleReached, type TaskData, type TaskStatus } from './task-model';

export const TABLE_TASK_STATES: TaskStatus[] = ['open', 'committed', 'idea', 'cancelled', 'completed'];
export type TableTaskFlag = 'any' | 'yes' | 'no';
export interface TableTaskFilters {
	states: TaskStatus[] | null;
	pin: TableTaskFlag;
	scheduled: TableTaskFlag;
	holding: TableTaskFlag;
	scheduledBy: string;
	windowOn: string;
}
export const DEFAULT_TABLE_TASK_FILTERS: TableTaskFilters = { states: null, pin: 'any', scheduled: 'any', holding: 'any', scheduledBy: '', windowOn: '' };
export function tableTaskFiltersFromState(value: unknown): TableTaskFilters {
	const data = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	const flag = (value: unknown): TableTaskFlag => value === 'yes' || value === 'no' ? value : 'any';
	const date = (value: unknown): string => typeof value === 'string' && (value === 'today' || validDate(value)) ? value : '';
	return { states: Array.isArray(data.states) ? TABLE_TASK_STATES.filter(state => (data.states as unknown[]).includes(state)) : null,
		pin: flag(data.pin), scheduled: flag(data.scheduled), holding: flag(data.holding), scheduledBy: date(data.scheduledBy), windowOn: date(data.windowOn) };
}
export function tableTaskFilterActive(filters: TableTaskFilters): boolean {
	return filters.states !== null || filters.pin !== 'any' || filters.scheduled !== 'any' || filters.holding !== 'any' || Boolean(filters.scheduledBy || filters.windowOn);
}
export function matchesTableTask(data: TaskData, filters: TableTaskFilters, today: string): boolean {
	if (!(filters.states ?? ['open', 'committed', 'idea']).includes(data.status)) return false;
	if (data.scheduled && !filters.scheduledBy && !taskScheduleReached(data.scheduled, today)) return false;
	const flag = (filter: TableTaskFlag, value: boolean): boolean => filter === 'any' || value === (filter === 'yes');
	if (!flag(filters.pin, data.pinned) || !flag(filters.scheduled, Boolean(data.scheduled)) || !flag(filters.holding, data.holding)) return false;
	if (filters.scheduledBy === 'today' && !taskScheduleReached(data.scheduled, today)) return false;
	const due = filters.scheduledBy === 'today' ? today.slice(0, 10) : filters.scheduledBy;
	if (due && (!data.scheduled || taskScheduledDay(data.scheduled) > due)) return false;
	const window = filters.windowOn === 'today' ? today.slice(0, 10) : filters.windowOn;
	// Keep overdue tasks visible; only a future window start excludes an unfinished task.
	if (window && data.windowStart && data.windowStart > window) return false;
	return true;
}
