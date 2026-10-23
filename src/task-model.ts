export type TaskStatus = 'idea' | 'committed' | 'open' | 'completed' | 'cancelled';
export type TaskEffort = '' | 'quick' | 'light' | 'normal' | 'deep';
export type TaskRepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TaskWindowState = 'upcoming' | 'current' | 'overdue';

export interface TaskData {
	taskId: string;
	status: TaskStatus;
	holding: boolean;
	holdingReview: string;
	holdingFor: string[];
	completedOccurrences: string[];
	content: string;
	pinned: boolean;
	windowStart: string;
	windowEnd: string;
	effort: TaskEffort;
	repeat: boolean;
	scheduled: string;
	repeatFrequency: TaskRepeatFrequency;
	repeatInterval: number;
	repeatMonthDay: number;
	repeatMonth: number;
}

export interface ParsedTaskLine {
	prefix: string;
	marker: string;
	close: string;
	data: TaskData;
	preservedFields: string[];
	blockId?: string;
}

const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\]\s*)(.*)$/u;
const INLINE_FIELD = /\[([^\]:]+)::\s*([^\]]*)\]/gu;
const TASK_FIELDS = new Set([
	'task_id',
	'thread_pin',
	'scheduled',
	'repeat',
	'window_start',
	'window_end',
	'effort',
	'holding',
	'holding_review',
	'holding_for',
	'completed_occurrences',
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export const EMPTY_TASK: TaskData = {
	taskId: '',
	status: 'open',
	holding: false,
	holdingReview: '',
	holdingFor: [],
	completedOccurrences: [],
	content: '',
	pinned: false,
	windowStart: '',
	windowEnd: '',
	effort: '',
	repeat: false,
	scheduled: '',
	repeatFrequency: 'daily',
	repeatInterval: 1,
	repeatMonthDay: 1,
	repeatMonth: 1,
};

function decodeInlineValue(value: string): string {
	return value.trim().replace(/&#93;/gu, ']');
}

export function validDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false;
	const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year
		&& date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day;
}

// Local calendar scheduling: optional hour, without a timezone or minute precision.
export function validTaskSchedule(value: string): boolean {
	return validDate(value) || (/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):00$/u.test(value) && validDate(value.slice(0, 10)));
}

export function taskScheduledDay(value: string): string { return value.slice(0, 10); }

function inputSchedule(value: string | undefined): string {
	const normalized = value?.trim() ?? '';
	return validTaskSchedule(normalized) ? normalized : '';
}

function inputDate(value: string | undefined): string {
	const normalized = value?.trim() ?? '';
	return validDate(normalized) ? normalized : '';
}

function inputTaskId(value: string | undefined): string {
	const normalized = value?.trim() ?? '';
	return /^task-[a-z0-9]{12}$/u.test(normalized) ? normalized : '';
}

export function createTaskId(): string {
	return `task-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function taskStatusFromMarker(marker: string): TaskStatus {
	if (marker.toLowerCase() === 'x') return 'completed';
	if (marker === '-') return 'cancelled';
	if (marker === '!') return 'idea';
	if (marker === '+') return 'committed';
	return 'open';
}

export function taskStatusMarker(status: TaskStatus): string {
	return { idea: '!', committed: '+', open: ' ', completed: 'x', cancelled: '-' }[status];
}

export function releaseTaskHolding(data: TaskData): TaskData {
	return { ...data, holding: false, holdingReview: '', holdingFor: [] };
}

export function completeTaskData(data: TaskData): TaskData {
	return {
		...releaseTaskHolding(data),
		status: 'completed',
		completedOccurrences: data.repeat && validTaskSchedule(data.scheduled)
			? [...new Set([...data.completedOccurrences, data.scheduled])].sort()
			: data.completedOccurrences,
	};
}

function taskEffort(value: string | undefined): TaskEffort {
	const normalized = value?.trim() ?? '';
	return ['quick', 'light', 'normal', 'deep'].includes(normalized)
		? normalized as TaskEffort
		: '';
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRepeatRule(value: string | undefined): Pick<
	TaskData,
	'repeat' | 'repeatFrequency' | 'repeatInterval' | 'repeatMonthDay' | 'repeatMonth'
> {
	const fields = new Map((value ?? '').split(';').flatMap((part) => {
		const [rawKey, rawValue] = part.split('=', 2);
		return rawKey && rawValue ? [[rawKey.trim().toUpperCase(), rawValue.trim().toUpperCase()]] : [];
	}));
	const frequencies: Record<string, TaskRepeatFrequency> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
	const frequency = frequencies[fields.get('FREQ') ?? ''];
	return {
		repeat: Boolean(frequency), repeatFrequency: frequency ?? 'daily',
		repeatInterval: positiveInteger(fields.get('INTERVAL'), 1),
		repeatMonthDay: Math.min(31, positiveInteger(fields.get('BYMONTHDAY'), 1)),
		repeatMonth: Math.min(12, positiveInteger(fields.get('BYMONTH'), 1)),
	};
}

function repeatRule(data: TaskData): string {
	const rule = [`FREQ=${data.repeatFrequency.toUpperCase()}`];
	if (data.repeatInterval > 1) rule.push(`INTERVAL=${data.repeatInterval}`);
	if (data.repeatFrequency === 'yearly') rule.push(`BYMONTH=${data.repeatMonth}`);
	if (data.repeatFrequency === 'monthly' || data.repeatFrequency === 'yearly') rule.push(`BYMONTHDAY=${data.repeatMonthDay}`);
	return rule.join(';');
}

export function parseTaskLine(line: string): ParsedTaskLine | undefined {
	const task = TASK_LINE.exec(line);
	if (!task) return undefined;
	let body = task[4] ?? '';
	const block = /\s+(\^[\p{Letter}\p{Number}_-]+)\s*$/u.exec(body);
	if (block) body = body.slice(0, block.index);
	const fields = new Map<string, string>();
	const preservedFields: string[] = [];
	body = body.replace(INLINE_FIELD, (source: string, rawKey: string, rawValue: string) => {
		const key = rawKey.trim();
		if (TASK_FIELDS.has(key)) fields.set(key, decodeInlineValue(rawValue));
		else preservedFields.push(source);
		return '';
	});
	const repeat = parseRepeatRule(fields.get('repeat'));
	return {
		prefix: task[1] ?? '- [',
		marker: task[2] ?? ' ',
		close: task[3] ?? '] ',
		data: {
			taskId: inputTaskId(fields.get('task_id')),
			status: taskStatusFromMarker(task[2] ?? ' '),
			holding: fields.get('holding')?.toLowerCase() === 'true',
			holdingReview: fields.get('holding_review') ?? '',
			holdingFor: (fields.get('holding_for') ?? '').split(',').map(value => value.trim()).filter(Boolean),
			completedOccurrences: (fields.get('completed_occurrences') ?? '').split(',').map(value => value.trim()).filter(validTaskSchedule),
			content: body.replace(/\s+/gu, ' ').trim(),
			pinned: !inputSchedule(fields.get('scheduled')) && fields.get('thread_pin')?.trim().toLowerCase() === 'true',
			windowStart: inputDate(fields.get('window_start')),
			windowEnd: inputDate(fields.get('window_end')),
			effort: taskEffort(fields.get('effort')),
			...repeat,
			scheduled: inputSchedule(fields.get('scheduled')),
		},
		preservedFields,
		blockId: block?.[1],
	};
}

export function buildTaskLine(data: TaskData, original?: ParsedTaskLine): string {
	const fields: string[] = [];
	if (data.taskId) fields.push(`[task_id:: ${data.taskId}]`);
	if (data.holding) {
		fields.push('[holding:: true]');
		if (data.holdingReview) fields.push(`[holding_review:: ${data.holdingReview}]`);
		if (data.holdingFor.length) fields.push(`[holding_for:: ${data.holdingFor.join(', ')}]`);
	}
	if (data.completedOccurrences.length) fields.push(`[completed_occurrences:: ${data.completedOccurrences.join(', ')}]`);
	if (data.pinned && !data.scheduled) fields.push('[thread_pin:: true]');
	if (data.windowStart) fields.push(`[window_start:: ${data.windowStart}]`);
	if (data.windowEnd) fields.push(`[window_end:: ${data.windowEnd}]`);
	if (data.effort) fields.push(`[effort:: ${data.effort}]`);
	if (data.scheduled) fields.push(`[scheduled:: ${data.scheduled}]`);
	if (data.scheduled && data.repeat) fields.push(`[repeat:: ${repeatRule(data)}]`);
	fields.push(...(original?.preservedFields ?? []));
	const body = [data.content.trim(), ...fields, original?.blockId]
		.filter((part): part is string => Boolean(part))
		.join(' ');
	return `${original?.prefix ?? '- ['}${taskStatusMarker(data.status)}${original?.close ?? '] '}${body}`;
}

export function taskValidationError(
	data: TaskData,
): 'task-id' | 'content' | 'window-order' | 'schedule-date' | 'repeat-interval' | 'holding-date' | undefined {
	if (data.holdingReview && !validDate(data.holdingReview)) return 'holding-date';
	if (!inputTaskId(data.taskId)) return 'task-id';
	if (!data.content.trim()) return 'content';
	if (data.windowStart && data.windowEnd && data.windowEnd < data.windowStart) return 'window-order';
	if ((data.scheduled && !inputSchedule(data.scheduled)) || (data.repeat && !data.scheduled)) return 'schedule-date';
	if (data.scheduled && data.repeat && (!Number.isSafeInteger(data.repeatInterval) || data.repeatInterval < 1)) {
		return 'repeat-interval';
	}
	return undefined;
}

function dateParts(value: string): [number, number, number] {
	const [year = 0, month = 0, day = 0] = value.slice(0, 10).split('-').map(Number);
	return [year, month, day];
}

function formatDate(date: Date): string {
	return [
		String(date.getUTCFullYear()).padStart(4, '0'),
		String(date.getUTCMonth() + 1).padStart(2, '0'),
		String(date.getUTCDate()).padStart(2, '0'),
	].join('-');
}

function addDays(value: string, days: number): string {
	const [year, month, day] = dateParts(value);
	return formatDate(new Date(Date.UTC(year, month - 1, day + days)));
}

function daysBetween(from: string, to: string): number {
	const [fromYear, fromMonth, fromDay] = dateParts(from);
	const [toYear, toMonth, toDay] = dateParts(to);
	return Math.round((
		Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)
	) / 86_400_000);
}

function calendarDate(year: number, month: number, day: number): string {
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return formatDate(new Date(Date.UTC(year, month - 1, Math.min(day, lastDay))));
}

function addMonths(value: string, months: number, monthDay: number): string {
	const [year, month] = dateParts(value);
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	return calendarDate(target.getUTCFullYear(), target.getUTCMonth() + 1, monthDay);
}

export function nextTaskScheduled(data: TaskData): string {
	if (!data.repeat || !validTaskSchedule(data.scheduled) || !Number.isSafeInteger(data.repeatInterval) || data.repeatInterval < 1) return '';
	let next: string;
	if (data.repeatFrequency === 'yearly') {
		const [year] = dateParts(data.scheduled);
		next = calendarDate(year + data.repeatInterval, data.repeatMonth, data.repeatMonthDay);
	} else if (data.repeatFrequency === 'monthly') {
		next = addMonths(data.scheduled, data.repeatInterval, data.repeatMonthDay);
	} else next = addDays(data.scheduled, data.repeatInterval * (data.repeatFrequency === 'weekly' ? 7 : 1));
	const scheduled = next + data.scheduled.slice(10);
	return validTaskSchedule(scheduled) && scheduled > data.scheduled ? scheduled : '';
}

function nextTaskScheduledOnOrAfter(data: TaskData, minimumDate: string): string {
	let scheduled = nextTaskScheduled(data);
	if (!scheduled || !validDate(minimumDate) || scheduled >= minimumDate) return scheduled;
	if (data.repeatFrequency === 'daily' || data.repeatFrequency === 'weekly') {
		const step = data.repeatInterval * (data.repeatFrequency === 'weekly' ? 7 : 1);
		const remaining = daysBetween(scheduled, minimumDate);
		const next = addDays(scheduled, Math.ceil(remaining / step) * step);
		return validDate(next) ? next + scheduled.slice(10) : '';
	}
	while (scheduled < minimumDate) {
		scheduled = nextTaskScheduled({ ...data, scheduled });
		if (!scheduled) return '';
	}
	return scheduled;
}

export function advanceTaskData(data: TaskData, minimumDate = ''): TaskData | undefined {
	const scheduled = nextTaskScheduledOnOrAfter(data, minimumDate);
	if (!scheduled) return undefined;
	const shift = daysBetween(data.scheduled, scheduled);
	return {
		...(data.status === 'completed' ? completeTaskData(data) : data),
		status: 'open',
		scheduled,
		windowStart: data.windowStart ? addDays(data.windowStart, shift) : '',
		windowEnd: data.windowEnd ? addDays(data.windowEnd, shift) : '',
	};
}

export function advanceTaskLine(line: string, minimumDate = ''): string | undefined {
	const parsed = parseTaskLine(line);
	if (!parsed) return undefined;
	const advanced = advanceTaskData(parsed.data, minimumDate);
	if (!advanced) return undefined;
	return buildTaskLine(advanced, parsed);
}

export function taskRepeatLabel(data: TaskData): string {
	if (!data.repeat) return '';
	if (data.repeatInterval === 1) return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[data.repeatFrequency];
	const unit = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[data.repeatFrequency];
	return `Every ${data.repeatInterval} ${unit}`;
}

export function taskWindowLabel(data: Pick<TaskData, 'windowStart' | 'windowEnd'>): string {
	if (data.windowStart && data.windowEnd) return `${data.windowStart} ～ ${data.windowEnd}`;
	if (data.windowStart) return `${data.windowStart} ～`;
	if (data.windowEnd) return `～ ${data.windowEnd}`;
	return '';
}

export function taskScheduledLabel(value: string, today: string, todayLabel: string): string {
	if (!value) return '';
	if (!validTaskSchedule(value) || !validDate(today)) return value;
	const date = taskScheduledDay(value);
	const [year, month, day] = dateParts(date);
	const [currentYear] = dateParts(today);
	const label = date === today ? todayLabel : year === currentYear ? `${month}/${day}` : `${year}/${month}/${day}`;
	return label + (value.length > 10 ? ` ${value.slice(11)}` : '');
}

export function taskWindowState(
	data: Pick<TaskData, 'windowStart' | 'windowEnd'>,
	today: string,
): TaskWindowState | undefined {
	if (!data.windowStart && !data.windowEnd) return undefined;
	if (data.windowStart && today < data.windowStart) return 'upcoming';
	if (data.windowEnd && today > data.windowEnd) return 'overdue';
	return 'current';
}

export function taskDraftFromTextLine(line: string): ParsedTaskLine {
	const source = /^(\s*(?:>\s*)*)(?:([-*+]|\d+[.)])\s+)?(.*)$/u.exec(line);
	const lead = source?.[1] ?? '';
	const listMarker = source?.[2] ?? '-';
	let content = source?.[3] ?? line.trim();
	const block = /\s+(\^[\p{Letter}\p{Number}_-]+)\s*$/u.exec(content);
	if (block) content = content.slice(0, block.index);
	return {
		prefix: `${lead}${listMarker} [`,
		marker: ' ',
		close: '] ',
		data: {
			...EMPTY_TASK,
			holdingFor: [],
			completedOccurrences: [],
			content: content.trim(),
		},
		preservedFields: [],
		blockId: block?.[1],
	};
}

// Date-only schedules become available at local midnight; hourly ones at the selected hour.
export function taskScheduleReached(scheduled: string, now: string): boolean {
 if (!validTaskSchedule(scheduled)) return false;
 const boundary = now.replace(' ', 'T');
 return scheduled <= (boundary.length === 10 ? `${boundary}T00:00` : boundary);
}

export function taskIsScheduledToday(data: Pick<TaskData, 'scheduled' | 'status'>, now: string): boolean {
 return taskScheduleReached(data.scheduled, now) && !['completed', 'cancelled'].includes(data.status);
}

export function taskNeedsPinnedAttention(data: Pick<TaskData, 'scheduled' | 'pinned' | 'status'>): boolean {
	return Boolean(data.pinned && !data.scheduled && data.status === 'open');
}
