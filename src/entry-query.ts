export type ThreadEntryType = 'checkpoint' | 'log';
export type ThreadEntryGroupBy = 'none' | 'thread' | 'type';

export interface ThreadEntryDateFilter {
	from: string;
	to: string;
}

export interface ThreadEntriesQuery {
	threadIds?: string[];
	date?: ThreadEntryDateFilter;
	types: ThreadEntryType[];
	groupBy: ThreadEntryGroupBy;
}

export interface ParsedThreadEntriesQuery {
	query: ThreadEntriesQuery;
	errors: string[];
}

const ENTRY_TYPES = new Set<ThreadEntryType>(['checkpoint', 'log']);
const GROUP_VALUES = new Set<ThreadEntryGroupBy>(['none', 'thread', 'type']);
const QUERY_KEYS = new Set(['thread_id', 'date', 'type', 'group_by']);

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

export function parseThreadEntriesQuery(source: string): ParsedThreadEntriesQuery {
	const values = new Map<string, string>();
	const errors: string[] = [];
	for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const separator = line.indexOf(':');
		if (separator < 1) {
			errors.push(`第 ${index + 1} 行不是 key: value 格式。`);
			continue;
		}
		const key = line.slice(0, separator).trim();
		if (!QUERY_KEYS.has(key)) {
			errors.push(`不支持查询字段 ${key}。`);
			continue;
		}
		if (values.has(key)) {
			errors.push(`查询字段 ${key} 重复。`);
			continue;
		}
		values.set(key, line.slice(separator + 1).trim());
	}

	let threadIds: string[] | undefined;
	const rawThreadIds = values.get('thread_id');
	if (rawThreadIds !== undefined) {
		const parsed = listValues(rawThreadIds);
		if (parsed.length === 0 || parsed.some((value) => value === 'all' || value === '*')) {
			if (parsed.length > 1) errors.push('thread_id 的 all 不能与其他值同时使用。');
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
					errors.push('date 范围的开始日期不能晚于结束日期。');
				} else {
					date = { from: range[1], to: range[2] };
				}
			} else {
				errors.push('date 只支持 YYYY-MM-DD 或 YYYY-MM-DD..YYYY-MM-DD。');
			}
		}
	}

	let types: ThreadEntryType[] = ['checkpoint', 'log'];
	const rawTypes = values.get('type');
	if (rawTypes !== undefined) {
		const parsed = listValues(rawTypes);
		if (parsed.length > 0 && !parsed.some((value) => value === 'all' || value === '*')) {
			const invalid = parsed.filter((value) => !ENTRY_TYPES.has(value as ThreadEntryType));
			if (invalid.length > 0) {
				errors.push(`不支持记录类型：${invalid.join('、')}。`);
			} else {
				types = [...new Set(parsed)] as ThreadEntryType[];
			}
		} else if (parsed.length > 1) {
			errors.push('type 的 all 不能与其他值同时使用。');
		}
	}

	let groupBy: ThreadEntryGroupBy = 'none';
	const rawGroupBy = values.get('group_by');
	if (rawGroupBy !== undefined) {
		const parsed = unquote(rawGroupBy) as ThreadEntryGroupBy;
		if (!GROUP_VALUES.has(parsed)) {
			errors.push('group_by 只支持 none、thread 或 type。');
		} else {
			groupBy = parsed;
		}
	}

	return {
		query: { threadIds, date, types, groupBy },
		errors,
	};
}
