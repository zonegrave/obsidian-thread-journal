export interface OpenThreadView<T> {
	threadId: string;
	role: string;
	filePath: string;
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

export function openThreadViewsForFile<T>(
	group: OpenThreadGroup<T>,
	filePath: string,
): OpenThreadView<T>[] {
	return group.views.filter((view) => view.filePath === filePath);
}

export function describeOpenThreadRoles<T>(group: OpenThreadGroup<T>): string {
	const counts = new Map<string, number>();
	for (const view of group.views) counts.set(view.role, (counts.get(view.role) ?? 0) + 1);
	return [...counts.entries()]
		.map(([role, count]) => count > 1 ? `${role} ×${count}` : role)
		.join(' + ');
}
