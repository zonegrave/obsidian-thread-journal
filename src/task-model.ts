import { is24HourTime } from './time-input';

export type TaskScheduleMode = 'flexible' | 'fixed';
export type TaskEffort = '' | 'quick' | 'light' | 'normal' | 'deep';

export interface TaskData {
	content: string;
	scheduleMode: TaskScheduleMode;
	windowStart: string;
	windowEnd: string;
	effort: TaskEffort;
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
	'schedule_mode',
	'window_start',
	'window_end',
	'effort',
]);

export const EMPTY_TASK: TaskData = {
	content: '',
	scheduleMode: 'flexible',
	windowStart: '',
	windowEnd: '',
	effort: '',
};

function decodeInlineValue(value: string): string {
	return value.trim().replace(/&#93;/gu, ']');
}

function inputDateTime(value: string): string {
	const normalized = value.trim().replace(' ', 'T');
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(normalized)
		&& is24HourTime(normalized.slice(11))
		? normalized
		: '';
}

function storedDateTime(value: string): string {
	return value.trim().replace('T', ' ');
}

function scheduleMode(value: string | undefined): TaskScheduleMode {
	return value?.trim() === 'fixed' ? 'fixed' : 'flexible';
}

function taskEffort(value: string | undefined): TaskEffort {
	const normalized = value?.trim() ?? '';
	return ['quick', 'light', 'normal', 'deep'].includes(normalized)
		? normalized as TaskEffort
		: '';
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
	return {
		prefix: task[1] ?? '- [',
		marker: task[2] ?? ' ',
		close: task[3] ?? '] ',
		data: {
			content: body.replace(/\s+/gu, ' ').trim(),
			scheduleMode: scheduleMode(fields.get('schedule_mode')),
			windowStart: inputDateTime(fields.get('window_start') ?? ''),
			windowEnd: inputDateTime(fields.get('window_end') ?? ''),
			effort: taskEffort(fields.get('effort')),
		},
		preservedFields,
		blockId: block?.[1],
	};
}

export function buildTaskLine(data: TaskData, original?: ParsedTaskLine): string {
	const fields: string[] = [];
	if (data.scheduleMode === 'fixed') fields.push('[schedule_mode:: fixed]');
	else if (data.windowStart || data.windowEnd || data.effort) {
		fields.push('[schedule_mode:: flexible]');
	}
	if (data.windowStart) fields.push(`[window_start:: ${storedDateTime(data.windowStart)}]`);
	if (data.windowEnd) fields.push(`[window_end:: ${storedDateTime(data.windowEnd)}]`);
	if (data.scheduleMode === 'flexible' && data.effort) {
		fields.push(`[effort:: ${data.effort}]`);
	}
	fields.push(...(original?.preservedFields ?? []));
	const body = [data.content.trim(), ...fields, original?.blockId]
		.filter((part): part is string => Boolean(part))
		.join(' ');
	return `${original?.prefix ?? '- ['}${original?.marker ?? ' '}${original?.close ?? '] '}${body}`;
}

export function taskValidationError(data: TaskData): 'content' | 'fixed-window' | 'window-order' | undefined {
	if (!data.content.trim()) return 'content';
	if (data.scheduleMode === 'fixed' && (!data.windowStart || !data.windowEnd)) {
		return 'fixed-window';
	}
	if (data.windowStart && data.windowEnd && data.windowEnd <= data.windowStart) {
		return 'window-order';
	}
	return undefined;
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
