import type { ThreadTableRow } from './thread-table-data';
import { buildRootedThreadOverviewTree, type ThreadOverviewNode } from './thread-overview-model';

export function tableRootTrail(rows: readonly ThreadTableRow[], root: string): { id: string; title: string; children: { id: string; title: string }[] }[] {
	const tree = buildRootedThreadOverviewTree(rows.map(row => ({ id: row.thread.id, title: row.thread.title, parent: row.parent, status: row.thread.status })), new Set(rows.map(row => row.thread.status)));
	const canonical = tree.find(node => node.item.id === 'ROOT');
	const top = canonical?.children ?? tree;
	const trail = [{ id: '', title: 'ROOT', children: top.map(node => ({ id: node.item.id, title: node.item.title })) }];
	const find = (nodes: ThreadOverviewNode[], path: ThreadOverviewNode[]): ThreadOverviewNode[] | undefined => {
		for (const node of nodes) {
			const next = [...path, node];
			if (node.item.id === root) return next;
			const found = find(node.children, next); if (found) return found;
		}
		return undefined;
	};
	for (const node of find(top, []) ?? []) trail.push({ id: node.item.id, title: node.item.title, children: node.children.map(child => ({ id: child.item.id, title: child.item.title })) });
	return trail;
}

