export type ThreadEntryType = 'commit' | 'log';
export type ThreadEntryGroupBy = 'none' | 'thread' | 'type';
export type ThreadEntryDetail = 'none' | 'name' | 'crumb';
export type ThreadEntryOrder = 'asc' | 'desc';

export interface ThreadEntryDateFilter {
	from: string;
	to: string;
}

export interface ThreadEntriesQuery {
	threadIds?: string[];
	date?: ThreadEntryDateFilter;
	types: ThreadEntryType[];
	groupBy: ThreadEntryGroupBy;
	threadDetail: ThreadEntryDetail;
	order: ThreadEntryOrder;
}

export interface ParsedThreadEntriesQuery {
	query: ThreadEntriesQuery;
	errors: string[];
}

const ENTRY_TYPES = new Set<ThreadEntryType>(['commit', 'log']);
const GROUP_VALUES = new Set<ThreadEntryGroupBy>(['none', 'thread', 'type']);
const THREAD_DETAIL_VALUES = new Set<ThreadEntryDetail>(['none', 'name', 'crumb']);
const ORDER_VALUES = new Set<ThreadEntryOrder>(['asc', 'desc']);
const QUERY_KEYS = new Set([
	'thread_id',
	'date',
	'type',
	'group_by',
	'thread_detail',
	'order',
]);

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"'))
		|| (trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function listValues(value: string): string[] {
	const trimmed = value.trim();
	const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
		? trimmed.slice(1, -1)
		: trimmed;
	return inner.split(',').map(unquote).filter(Boolean);
}

export function formatThreadEntryTimestamp(
	date: string,
	time: string,
	timeOnly = false,
): string {
	if (timeOnly && time) return time;
	const match = /^(\d{2})(\d{2})-(\d{2})-(\d{2})$/u.exec(date);
	const compactDate = match
		? `${match[2]}/${match[3]}/${match[4]}`
		: date;
	return time ? `${compactDate} ${time}` : compactDate;
}

export function compareThreadEntryTimestamps(
	left: string,
	right: string,
	order: ThreadEntryOrder,
): number {
	return (order === 'asc' ? 1 : -1) * left.localeCompare(right);
}

export function parseThreadEntriesQuery(source: string): ParsedThreadEntriesQuery {
	const values = new Map<string, string>();
	const errors: string[] = [];
	for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const separator = line.indexOf(':');
		if (separator < 1) {
			errors.push(t('Line {line} is not in key: value format.', { line: index + 1 }));
			continue;
		}
		const key = line.slice(0, separator).trim();
		if (!QUERY_KEYS.has(key)) {
			errors.push(t('Unsupported query field: {key}.', { key }));
			continue;
		}
		if (values.has(key)) {
			errors.push(t('Query field {key} is duplicated.', { key }));
			continue;
		}
		values.set(key, line.slice(separator + 1).trim());
	}

	let threadIds: string[] | undefined;
	const rawThreadIds = values.get('thread_id');
	if (rawThreadIds !== undefined) {
		const parsed = listValues(rawThreadIds);
		if (parsed.length === 0 || parsed.some((value) => value === 'all' || value === '*')) {
			if (parsed.length > 1) errors.push(t('thread_id all cannot be combined with other values.'));
		} else {
			threadIds = [...new Set(parsed)];
		}
	}

	let date: ThreadEntryDateFilter | undefined;
	const rawDate = values.get('date');
	if (rawDate !== undefined) {
		const parsed = unquote(rawDate);
		if (parsed && parsed !== 'all' && parsed !== '*') {
			const exact = /^(\d{4}-\d{2}-\d{2})$/u.exec(parsed);
			const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/u.exec(parsed);
			if (exact?.[1]) {
				date = { from: exact[1], to: exact[1] };
			} else if (range?.[1] && range[2]) {
				if (range[1] > range[2]) {
					errors.push(t('The start date of a date range cannot be later than its end date.'));
				} else {
					date = { from: range[1], to: range[2] };
				}
			} else {
				errors.push(t('date supports only YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD.'));
			}
		}
	}

	let types: ThreadEntryType[] = ['commit', 'log'];
	const rawTypes = values.get('type');
	if (rawTypes !== undefined) {
		const parsed = listValues(rawTypes);
		if (parsed.length > 0 && !parsed.some((value) => value === 'all' || value === '*')) {
			const invalid = parsed.filter((value) => !ENTRY_TYPES.has(value as ThreadEntryType));
			if (invalid.length > 0) {
				errors.push(t('Unsupported entry types: {types}.', { types: invalid.join(', ') }));
			} else {
				types = [...new Set(parsed)] as ThreadEntryType[];
			}
		} else if (parsed.length > 1) {
			errors.push(t('type all cannot be combined with other values.'));
		}
	}

	let groupBy: ThreadEntryGroupBy = 'none';
	const rawGroupBy = values.get('group_by');
	if (rawGroupBy !== undefined) {
		const parsed = unquote(rawGroupBy) as ThreadEntryGroupBy;
		if (!GROUP_VALUES.has(parsed)) {
			errors.push(t('group_by supports only none, thread, or type.'));
		} else {
			groupBy = parsed;
		}
	}

	let threadDetail: ThreadEntryDetail = 'none';
	const rawThreadDetail = values.get('thread_detail');
	if (rawThreadDetail !== undefined) {
		const parsed = unquote(rawThreadDetail) as ThreadEntryDetail;
		if (!THREAD_DETAIL_VALUES.has(parsed)) {
			errors.push(t('thread_detail supports only none, name, or crumb.'));
		} else {
			threadDetail = parsed;
		}
	}

	let order: ThreadEntryOrder = 'desc';
	const rawOrder = values.get('order');
	if (rawOrder !== undefined) {
		const parsed = unquote(rawOrder) as ThreadEntryOrder;
		if (!ORDER_VALUES.has(parsed)) {
			errors.push(t('order supports only asc or desc.'));
		} else {
			order = parsed;
		}
	}

	return {
		query: { threadIds, date, types, groupBy, threadDetail, order },
		errors,
	};
}
import { t } from './i18n';
