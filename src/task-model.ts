export type TaskEffort = '' | 'quick' | 'light' | 'normal' | 'deep';
export type TaskRepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';
export type TaskWindowState = 'upcoming' | 'current' | 'overdue';

export interface TaskData {
	taskId: string;
	content: string;
	pinned: boolean;
	windowStart: string;
	windowEnd: string;
	effort: TaskEffort;
	repeat: boolean;
	current: string;
	repeatFrequency: TaskRepeatFrequency;
	repeatInterval: number;
	repeatMonthDay: number;
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
	'current',
	'repeat',
	'window_start',
	'window_end',
	'effort',
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export const EMPTY_TASK: TaskData = {
	taskId: '',
	content: '',
	pinned: false,
	windowStart: '',
	windowEnd: '',
	effort: '',
	repeat: false,
	current: '',
	repeatFrequency: 'daily',
	repeatInterval: 2,
	repeatMonthDay: 1,
};

function decodeInlineValue(value: string): string {
	return value.trim().replace(/&#93;/gu, ']');
}

function validDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false;
	const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year
		&& date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day;
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
	'repeat' | 'repeatFrequency' | 'repeatInterval' | 'repeatMonthDay'
> {
	const fields = new Map((value ?? '').split(';').flatMap((part) => {
		const [rawKey, rawValue] = part.split('=', 2);
		return rawKey && rawValue ? [[rawKey.trim().toUpperCase(), rawValue.trim().toUpperCase()]] : [];
	}));
	const frequency = fields.get('FREQ');
	if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency ?? '')) {
		return { repeat: false, repeatFrequency: 'daily', repeatInterval: 2, repeatMonthDay: 1 };
	}
	const interval = positiveInteger(fields.get('INTERVAL'), 1);
	if (frequency === 'WEEKLY') {
		return { repeat: true, repeatFrequency: 'weekly', repeatInterval: 1, repeatMonthDay: 1 };
	}
	if (frequency === 'MONTHLY') {
		return {
			repeat: true,
			repeatFrequency: 'monthly',
			repeatInterval: 1,
			repeatMonthDay: Math.min(31, positiveInteger(fields.get('BYMONTHDAY'), 1)),
		};
	}
	return {
		repeat: true,
		repeatFrequency: interval === 1 ? 'daily' : 'custom',
		repeatInterval: Math.max(2, interval),
		repeatMonthDay: 1,
	};
}

function repeatRule(data: TaskData): string {
	if (data.repeatFrequency === 'weekly') return 'FREQ=WEEKLY';
	if (data.repeatFrequency === 'monthly') {
		const monthDay = Math.min(31, Math.max(1, Math.trunc(data.repeatMonthDay)));
		return `FREQ=MONTHLY;BYMONTHDAY=${monthDay}`;
	}
	if (data.repeatFrequency === 'custom') {
		return `FREQ=DAILY;INTERVAL=${Math.max(2, Math.trunc(data.repeatInterval))}`;
	}
	return 'FREQ=DAILY';
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
			content: body.replace(/\s+/gu, ' ').trim(),
			pinned: fields.get('thread_pin')?.trim().toLowerCase() === 'true',
			windowStart: inputDate(fields.get('window_start')),
			windowEnd: inputDate(fields.get('window_end')),
			effort: taskEffort(fields.get('effort')),
			...repeat,
			current: inputDate(fields.get('current')),
		},
		preservedFields,
		blockId: block?.[1],
	};
}

export function buildTaskLine(data: TaskData, original?: ParsedTaskLine): string {
	const fields: string[] = [];
	if (data.taskId) fields.push(`[task_id:: ${data.taskId}]`);
	if (data.pinned) fields.push('[thread_pin:: true]');
	if (data.windowStart) fields.push(`[window_start:: ${data.windowStart}]`);
	if (data.windowEnd) fields.push(`[window_end:: ${data.windowEnd}]`);
	if (data.effort) fields.push(`[effort:: ${data.effort}]`);
	if (data.repeat) {
		fields.push(`[current:: ${data.current}]`);
		fields.push(`[repeat:: ${repeatRule(data)}]`);
	}
	fields.push(...(original?.preservedFields ?? []));
	const body = [data.content.trim(), ...fields, original?.blockId]
		.filter((part): part is string => Boolean(part))
		.join(' ');
	return `${original?.prefix ?? '- ['}${original?.marker ?? ' '}${original?.close ?? '] '}${body}`;
}

export function taskValidationError(
	data: TaskData,
): 'task-id' | 'content' | 'window-order' | 'repeat-current' | 'repeat-interval' | undefined {
	if (!inputTaskId(data.taskId)) return 'task-id';
	if (!data.content.trim()) return 'content';
	if (data.windowStart && data.windowEnd && data.windowEnd < data.windowStart) return 'window-order';
	if (data.repeat && !inputDate(data.current)) return 'repeat-current';
	if (data.repeat && data.repeatFrequency === 'custom'
		&& (!Number.isInteger(data.repeatInterval) || data.repeatInterval < 2)) {
		return 'repeat-interval';
	}
	return undefined;
}

function dateParts(value: string): [number, number, number] {
	const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
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

function addMonth(value: string, monthDay: number): string {
	const [year, month] = dateParts(value);
	const target = new Date(Date.UTC(year, month, 1));
	const targetYear = target.getUTCFullYear();
	const targetMonth = target.getUTCMonth();
	const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
	return formatDate(new Date(Date.UTC(targetYear, targetMonth, Math.min(monthDay, lastDay))));
}

export function nextTaskCurrent(data: TaskData): string {
	if (!data.repeat || !validDate(data.current)) return '';
	if (data.repeatFrequency === 'weekly') return addDays(data.current, 7);
	if (data.repeatFrequency === 'monthly') {
		return addMonth(data.current, Math.min(31, Math.max(1, Math.trunc(data.repeatMonthDay))));
	}
	return addDays(
		data.current,
		data.repeatFrequency === 'custom' ? Math.max(2, Math.trunc(data.repeatInterval)) : 1,
	);
}

function nextTaskCurrentOnOrAfter(data: TaskData, minimumCurrent: string): string {
	let current = nextTaskCurrent(data);
	if (!current || !validDate(minimumCurrent) || current >= minimumCurrent) return current;
	if (data.repeatFrequency !== 'monthly') {
		const step = data.repeatFrequency === 'weekly'
			? 7
			: data.repeatFrequency === 'custom'
				? Math.max(2, Math.trunc(data.repeatInterval))
				: 1;
		const remaining = daysBetween(current, minimumCurrent);
		return addDays(current, Math.ceil(remaining / step) * step);
	}
	while (current < minimumCurrent) {
		current = addMonth(current, Math.min(31, Math.max(1, Math.trunc(data.repeatMonthDay))));
	}
	return current;
}

export function advanceTaskData(data: TaskData, minimumCurrent = ''): TaskData | undefined {
	const current = nextTaskCurrentOnOrAfter(data, minimumCurrent);
	if (!current) return undefined;
	const shift = daysBetween(data.current, current);
	return {
		...data,
		current,
		windowStart: data.windowStart ? addDays(data.windowStart, shift) : '',
		windowEnd: data.windowEnd ? addDays(data.windowEnd, shift) : '',
	};
}

export function advanceTaskLine(line: string, minimumCurrent = ''): string | undefined {
	const parsed = parseTaskLine(line);
	if (!parsed) return undefined;
	const advanced = advanceTaskData(parsed.data, minimumCurrent);
	if (!advanced) return undefined;
	return buildTaskLine(advanced, { ...parsed, marker: ' ' });
}

export function taskRepeatLabel(data: TaskData): string {
	if (!data.repeat) return '';
	if (data.repeatFrequency === 'weekly') return 'Weekly';
	if (data.repeatFrequency === 'monthly') return 'Monthly';
	if (data.repeatFrequency === 'custom') return `Every ${data.repeatInterval} days`;
	return 'Daily';
}

export function taskWindowLabel(data: Pick<TaskData, 'windowStart' | 'windowEnd'>): string {
	if (data.windowStart && data.windowEnd) return `${data.windowStart} ～ ${data.windowEnd}`;
	if (data.windowStart) return `${data.windowStart} ～`;
	if (data.windowEnd) return `～ ${data.windowEnd}`;
	return '';
}

export function taskCurrentLabel(value: string, today: string, todayLabel: string): string {
	if (!value) return '';
	if (value === today) return todayLabel;
	if (!validDate(value) || !validDate(today)) return value;
	const [year, month, day] = dateParts(value);
	const [currentYear] = dateParts(today);
	return year === currentYear ? `${month}/${day}` : `${year}/${month}/${day}`;
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

export interface TaskInsertionEdit {
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	replacement: string;
	cursor: { line: number; ch: number };
}

export function taskInsertionEdit(lines: readonly string[], line: number, taskLine: string): TaskInsertionEdit {
	const index = Math.max(0, Math.min(Math.trunc(line), Math.max(0, lines.length - 1)));
	const current = lines[index] ?? '';
	if (!current.trim()) {
		return {
			from: { line: index, ch: 0 },
			to: { line: index, ch: current.length },
			replacement: taskLine,
			cursor: { line: index, ch: taskLine.length },
		};
	}
	const indent = /^\s*/u.exec(current)?.[0] ?? '';
	const replacement = `\n${indent}${taskLine}`;
	return {
		from: { line: index, ch: current.length },
		to: { line: index, ch: current.length },
		replacement,
		cursor: { line: index + 1, ch: indent.length + taskLine.length },
	};
}
