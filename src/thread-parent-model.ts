import { isOperationalThreadStatus } from './thread-status-model';

export interface ThreadParentNode {
	id: string;
	status: string;
	parent?: string;
}

export function wouldCreateThreadParentCycle(
	nodes: readonly ThreadParentNode[],
	threadId: string,
	candidateId: string,
): boolean {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const visited = new Set<string>();
	let cursor: string | undefined = candidateId;
	while (cursor && !visited.has(cursor)) {
		if (cursor === threadId) return true;
		visited.add(cursor);
		cursor = byId.get(cursor)?.parent;
	}
	return false;
}

export function availableThreadParentIds(
	nodes: readonly ThreadParentNode[],
	threadId: string,
): string[] {
	return nodes
		.filter((node) => isOperationalThreadStatus(node.status))
		.filter((node) => !wouldCreateThreadParentCycle(nodes, threadId, node.id))
		.map((node) => node.id);
}
