import type { ThreadTableRow, ThreadTableFileRow } from './thread-table-data';
import { buildRootedThreadOverviewTree, type ThreadOverviewNode } from './thread-overview-model';
import type { ThreadTableTreeRow } from './thread-table-model';
import { ROOT_THREAD_ID } from './thread-root-model';

export interface ExplorerNode {
	key: string; kind: 'thread' | 'file'; parent: string; path: string; title: string; order?: number; threadId: string; parentLink?: string;
}
export function explorerOrder(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined; }
export function compareExplorerNodes(a: ExplorerNode, b: ExplorerNode): number {
	if (a.order !== undefined || b.order !== undefined) {
		if (a.order === undefined) return 1;
		if (b.order === undefined) return -1;
		if (a.order !== b.order) return a.order - b.order;
	}
	return (a.kind === b.kind ? 0 : a.kind === 'file' ? -1 : 1) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}
export function threadExplorerNode(row: ThreadTableRow, parent: string): ExplorerNode {
	return { key: `thread:${row.thread.id}`, threadId: row.thread.id, parentLink: row.thread.parentLink ?? '', kind: 'thread', parent, path: row.thread.file.path, title: row.thread.title, order: row.order };
}
export function fileExplorerNode(file: ThreadTableFileRow): ExplorerNode {
	return { key: `file:${file.member.file.path}`, threadId: file.member.threadId, kind: 'file', parent: file.member.threadId, path: file.member.file.path, title: file.member.file.basename, order: file.order };
}
export function allExplorerNodes(rows: readonly ThreadTableRow[]): ExplorerNode[] {
	const byId = new Map(rows.map(row => [row.thread.id, row]));
	const tree = buildRootedThreadOverviewTree(rows.map(row => ({ id: row.thread.id, title: row.thread.title, status: row.thread.status, parent: row.parent })), new Set(rows.map(row => row.thread.status)));
	const nodes: ExplorerNode[] = [];
	const visit = (branches: ThreadOverviewNode[], parent: string): void => {
		for (const node of branches) {
			const row = byId.get(node.item.id); if (!row) continue;
			nodes.push(threadExplorerNode(row, parent), ...row.files.map(fileExplorerNode));
			visit(node.children, row.thread.id);
		}
	};
	visit(tree, ROOT_THREAD_ID);
	return nodes;
}

// Reorder against the full sibling group, including nodes currently hidden by filters.
export function explorerMovePlan(nodes: readonly ExplorerNode[], sourceKey: string, targetKey: string, side: 'before' | 'after'): Map<string, number> {
	const source = nodes.find(node => node.key === sourceKey); const target = nodes.find(node => node.key === targetKey);
	if (!source || !target || source === target || source.parent !== target.parent || sourceKey === `thread:${ROOT_THREAD_ID}` || targetKey === `thread:${ROOT_THREAD_ID}`) return new Map();
	const siblings = nodes.filter(node => node.parent === source.parent && node.key !== `thread:${ROOT_THREAD_ID}`).sort(compareExplorerNodes);
	const next = siblings.filter(node => node !== source);
	next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, source);
	if (next.every((node, index) => node === siblings[index])) return new Map();
	const index = next.indexOf(source); const before = next[index - 1]; const after = next[index + 1];
	let order: number | undefined;
	if (!before) order = after?.order === undefined ? 0 : after.order - 1024;
	else if (before.order !== undefined && !after) order = before.order + 1024;
	else if (before.order !== undefined && after?.order === undefined) order = before.order + 1024;
	else if (before.order !== undefined && after?.order !== undefined && after.order - before.order > 1) order = Math.floor(before.order + (after.order - before.order) / 2);
	if (explorerOrder(order) !== undefined) {
		const result = new Map([[source.path, order!]]);
		const check = siblings.map(node => node === source ? { ...node, order } : node).sort(compareExplorerNodes);
		if (check.every((node, index) => node.key === next[index]?.key)) return result;
	}
	// Initialize unranked siblings or replenish gaps; do not touch membership fields.
	return new Map(next.flatMap((node, index) => node.order === (index + 1) * 1024 ? [] : [[node.path, (index + 1) * 1024]]));
}

export type ExplorerGuide = Pick<ThreadTableTreeRow, 'depth' | 'guides' | 'ancestors' | 'last'>;
export type ExplorerTreeEntry = { kind: 'thread'; item: ThreadTableTreeRow; data: ThreadTableRow } | { kind: 'file'; item: ExplorerGuide; data: ThreadTableRow; file: ThreadTableFileRow };
export function flattenExplorerTree(tree: ThreadOverviewNode[], rows: ReadonlyMap<string, ThreadTableRow>, collapsed: ReadonlySet<string>,
	filesExpanded: (id: string) => boolean, fileMatches: ReadonlyMap<string, ReadonlySet<string>>): ExplorerTreeEntry[] {
	const output: ExplorerTreeEntry[] = [];
	const visit = (node: ThreadOverviewNode, item: ExplorerGuide): void => {
		const data = rows.get(node.item.id); if (!data) return;
		output.push({ kind: 'thread', item: { ...item, node }, data });
		const matches = fileMatches.get(data.thread.id);
		const files = !node.contextOnly && filesExpanded(data.thread.id) ? data.files.filter(file => !matches || matches.has(file.member.file.path)) : [];
		const children = collapsed.has(node.item.id) ? [] : node.children;
		const entries = [...files.map(file => ({ order: fileExplorerNode(file), file })), ...children.flatMap(child => {
			const row = rows.get(child.item.id); return row ? [{ order: threadExplorerNode(row, data.thread.id), child }] : [];
		})].sort((a, b) => compareExplorerNodes(a.order, b.order));
		for (const [index, entry] of entries.entries()) {
			const position = { depth: item.depth + 1, guides: item.depth ? [...item.guides, !item.last] : [], ancestors: [...item.ancestors, node.item.id], last: index === entries.length - 1 };
			if ('file' in entry) output.push({ kind: 'file', item: position, data, file: entry.file }); else visit(entry.child, position);
		}
	};
	for (const [index, node] of tree.entries()) visit(node, { depth: 0, guides: [], ancestors: [], last: index === tree.length - 1 });
	return output;
}
