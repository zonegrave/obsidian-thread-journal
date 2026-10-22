import type { ThreadTableRow } from './thread-table-data';
import { buildRootedThreadOverviewTree, filterThreadOverviewTree, type ThreadOverviewNode } from './thread-overview-model';

export const TABLE_PRESENCE_COLUMNS = ['open', 'committed', 'idea', 'completed', 'cancelled', 'holding', 'scheduled', 'pinned'] as const;
export type TablePresenceColumn = typeof TABLE_PRESENCE_COLUMNS[number];

export interface TableFilters {
	root: string;
	query: string;
	statuses: string[] | null;
	fileStatuses: ('active' | 'terminated')[] | null;
	present: TablePresenceColumn[];
}
export const DEFAULT_TABLE_FILTERS: TableFilters = { root: '', query: '', statuses: null, fileStatuses: null, present: [] };

export function tableFiltersFromState(value: unknown): TableFilters {
	const data = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	return {
		root: typeof data.root === 'string' ? data.root : '', query: typeof data.query === 'string' ? data.query : '',
		statuses: Array.isArray(data.statuses) ? data.statuses.filter((s): s is string => typeof s === 'string') : null,
		fileStatuses: Array.isArray(data.fileStatuses) ? (['active', 'terminated'] as const).filter(status => (data.fileStatuses as unknown[]).includes(status)) : null,
		present: Array.isArray(data.present) ? TABLE_PRESENCE_COLUMNS.filter(key => (data.present as unknown[]).includes(key)) : [],
	};
}

export function tableHasConditions(filters: TableFilters): boolean {
	return Boolean(filters.query.trim() || filters.statuses !== null || filters.fileStatuses !== null || filters.present.length > 0);
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
		if (filters.present.some(key => row.counts[key] === 0)) return false;
		const eligible = row.files.filter(file => filters.fileStatuses === null || filters.fileStatuses.includes(file.member.roleStatus));
		if (filters.fileStatuses !== null) fileMatches.set(row.thread.id, new Set(eligible.map(file => file.member.file.path)));
		if (!query || row.thread.title.toLocaleLowerCase().includes(query)) return true;
		const files = eligible.filter(file => file.member.file.basename.toLocaleLowerCase().includes(query));
		if (!files.length) return false;
		fileMatches.set(row.thread.id, new Set(files.map(file => file.member.file.path)));
		return true;
	});
	const matches = new Set(matchedRows.map(row => row.thread.id));
	return { tree: filterThreadOverviewTree(scope, item => matches.has(item.id)), matchedRows, fileMatches };
}
