export type OpenThreadSurface = 'context' | 'workspace';

export interface OpenThreadView<T> {
	threadId: string;
	surface: OpenThreadSurface;
	target: T;
	order: number;
}

export interface OpenThreadGroup<T> {
	threadId: string;
	views: OpenThreadView<T>[];
	firstOrder: number;
}

export function groupOpenThreadViews<T>(views: OpenThreadView<T>[]): OpenThreadGroup<T>[] {
	const groups = new Map<string, OpenThreadGroup<T>>();
	for (const view of views) {
		const group = groups.get(view.threadId);
		if (group) {
			group.views.push(view);
			group.firstOrder = Math.min(group.firstOrder, view.order);
			continue;
		}
		groups.set(view.threadId, {
			threadId: view.threadId,
			views: [view],
			firstOrder: view.order,
		});
	}
	return [...groups.values()];
}

export function orderOpenThreadGroups<T>(
	groups: OpenThreadGroup<T>[],
	recentThreadIds: string[],
): OpenThreadGroup<T>[] {
	const recentRank = new Map<string, number>();
	for (const threadId of recentThreadIds) {
		if (!recentRank.has(threadId)) recentRank.set(threadId, recentRank.size);
	}
	return [...groups].sort((left, right) => {
		const leftRank = recentRank.get(left.threadId);
		const rightRank = recentRank.get(right.threadId);
		if (leftRank !== undefined || rightRank !== undefined) {
			if (leftRank === undefined) return 1;
			if (rightRank === undefined) return -1;
			if (leftRank !== rightRank) return leftRank - rightRank;
		}
		return left.firstOrder - right.firstOrder;
	});
}

export function openThreadViewsForSurface<T>(
	group: OpenThreadGroup<T>,
	surface: OpenThreadSurface,
): OpenThreadView<T>[] {
	return group.views.filter((view) => view.surface === surface);
}

export function describeOpenThreadSurfaces<T>(group: OpenThreadGroup<T>): string {
	const contextCount = openThreadViewsForSurface(group, 'context').length;
	const workspaceCount = openThreadViewsForSurface(group, 'workspace').length;
	const parts: string[] = [];
	if (contextCount > 0) parts.push(contextCount > 1 ? `Context ×${contextCount}` : 'Context');
	if (workspaceCount > 0) {
		parts.push(workspaceCount > 1 ? `Workspace ×${workspaceCount}` : 'Workspace');
	}
	return parts.join(' + ');
}
