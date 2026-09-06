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

export function preferredOpenThreadView<T>(
	group: OpenThreadGroup<T>,
	recentTarget?: T,
): OpenThreadView<T> | undefined {
	if (recentTarget !== undefined) {
		const remembered = group.views.find((view) => view.target === recentTarget);
		if (remembered) return remembered;
	}
	return group.views.find((view) => view.surface === 'workspace') ?? group.views[0];
}
