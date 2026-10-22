import type { ThreadTableRow } from './thread-table-data';
import { buildRootedThreadOverviewTree, filterThreadOverviewTree, type ThreadOverviewNode } from './thread-overview-model';

import { DEFAULT_TABLE_TASK_FILTERS, matchesTableTask, tableTaskFilterActive, tableTaskFiltersFromState, type TableTaskFilters } from './thread-table-task-filter';
import { countTableTask, emptyThreadTableCounts } from './thread-table-model';

export interface TableFilters {
	root: string;
	query: string;
	statuses: string[] | null;
	fileStatuses: ('active' | 'terminated')[] | null;
	tasks: TableTaskFilters;
}
export const DEFAULT_TABLE_FILTERS: TableFilters = { root: '', query: '', statuses: null, fileStatuses: null, tasks: DEFAULT_TABLE_TASK_FILTERS };

export function tableFiltersFromState(value: unknown): TableFilters {
	const data = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	return {
		root: typeof data.root === 'string' ? data.root : '', query: typeof data.query === 'string' ? data.query : '',
		statuses: Array.isArray(data.statuses) ? data.statuses.filter((s): s is string => typeof s === 'string') : null,
		fileStatuses: Array.isArray(data.fileStatuses) ? (['active', 'terminated'] as const).filter(status => (data.fileStatuses as unknown[]).includes(status)) : null,
		tasks: tableTaskFiltersFromState(data.tasks),
	};
}

export function tableHasConditions(filters: TableFilters): boolean {
	return Boolean(filters.query.trim() || filters.statuses !== null || filters.fileStatuses !== null || tableTaskFilterActive(filters.tasks));
}

export function filterThreadTable(rows: readonly ThreadTableRow[], filters: TableFilters, today = new Date().toLocaleDateString('en-CA')): {
	tree: ThreadOverviewNode[]; matchedRows: ThreadTableRow[]; fileMatches: Map<string, Set<string>>;
} {
	const taskFiltered = tableTaskFilterActive(filters.tasks);
	const projected = rows.map(row => {
		const tasks = row.tasks.filter(task => matchesTableTask(task.data, filters.tasks, today));
		const counts = { ...emptyThreadTableCounts(), files: row.counts.files, children: row.counts.children, commits: row.counts.commits, logs: row.counts.logs };
		for (const task of tasks) countTableTask(counts, task.data, today);
		return { ...row, tasks, counts, files: row.files.map(file => {
			const counts = { ...emptyThreadTableCounts(), commits: file.counts.commits, logs: file.counts.logs };
			for (const task of tasks) if (task.file.path === file.member.file.path) countTableTask(counts, task.data, today);
			return { ...file, counts };
		}) };
	});
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
	const matchedRows = projected.filter(row => {
		if (!allowed.has(row.thread.id)) return false;
		if (filters.statuses !== null && !filters.statuses.includes(row.thread.status)) return false;
		if (taskFiltered && !row.tasks.length) return false;
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
