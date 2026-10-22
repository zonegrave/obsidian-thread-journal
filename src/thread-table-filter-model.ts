import type { ThreadTableRow } from './thread-table-data';
import { buildRootedThreadOverviewTree, filterThreadOverviewTree, type ThreadOverviewNode } from './thread-overview-model';

export interface TableFilters {
	root: string;
	query: string;
	statuses: string[] | null;
	tasks: 'any' | 'with' | 'without' | 'range';
	min: number | null;
	max: number | null;
}
export const DEFAULT_TABLE_FILTERS: TableFilters = { root: '', query: '', statuses: null, tasks: 'any', min: null, max: null };

export function tableFiltersFromState(value: unknown): TableFilters {
	const data = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	const number = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
	return {
		root: typeof data.root === 'string' ? data.root : '', query: typeof data.query === 'string' ? data.query : '',
		statuses: Array.isArray(data.statuses) ? data.statuses.filter((s): s is string => typeof s === 'string') : null,
		tasks: ['with', 'without', 'range'].includes(String(data.tasks)) ? data.tasks as TableFilters['tasks'] : 'any',
		min: number(data.min), max: number(data.max),
	};
}

export function tableHasConditions(filters: TableFilters): boolean {
	return Boolean(filters.query.trim() || filters.statuses !== null || filters.tasks !== 'any');
}

export function filterThreadTable(rows: readonly ThreadTableRow[], filters: TableFilters): {
	tree: ThreadOverviewNode[]; matchedRows: ThreadTableRow[]; fileMatches: Map<string, Set<string>>;
} {
	const full = buildRootedThreadOverviewTree(rows.map(row => ({ id: row.thread.id, title: row.thread.title,
		status: row.thread.status, parent: row.parent })), new Set(rows.map(row => row.thread.status)));
	const findRoot = (nodes: ThreadOverviewNode[]): ThreadOverviewNode | undefined => {
		for (const node of nodes) {
			if (node.item.id === filters.root) return node;
			const found = findRoot(node.children); if (found) return found;
		}
		return undefined;
	};
	const root = filters.root ? findRoot(full) : undefined;
	const scope = filters.root ? root ? [root] : [] : full;
	const allowed = new Set<string>();
	const visit = (nodes: ThreadOverviewNode[]): void => { for (const node of nodes) { allowed.add(node.item.id); visit(node.children); } };
	visit(scope);
	const query = filters.query.trim().toLocaleLowerCase();
	const fileMatches = new Map<string, Set<string>>();
	const matchedRows = rows.filter(row => {
		if (!allowed.has(row.thread.id)) return false;
		if (filters.statuses !== null && !filters.statuses.includes(row.thread.status)) return false;
		const count = row.counts.open + row.counts.committed + row.counts.idea;
		if (filters.tasks === 'with' && count === 0) return false;
		if (filters.tasks === 'without' && count !== 0) return false;
		if (filters.tasks === 'range' && ((filters.min !== null && count < filters.min) || (filters.max !== null && count > filters.max))) return false;
		if (!query || row.thread.title.toLocaleLowerCase().includes(query)) return true;
		const files = row.files.filter(file => file.member.file.basename.toLocaleLowerCase().includes(query));
		if (!files.length) return false;
		fileMatches.set(row.thread.id, new Set(files.map(file => file.member.file.path)));
		return true;
	});
	const matches = new Set(matchedRows.map(row => row.thread.id));
	return { tree: filterThreadOverviewTree(scope, item => matches.has(item.id)), matchedRows, fileMatches };
}
