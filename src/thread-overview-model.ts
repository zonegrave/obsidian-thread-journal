export const DEFAULT_THREAD_OVERVIEW_STATUSES = ['active', 'dormant'] as const;

export interface ThreadOverviewItem {
	id: string;
	parent?: string;
	status: string;
	title: string;
}

export interface ThreadOverviewNode {
	item: ThreadOverviewItem;
	contextOnly: boolean;
	children: ThreadOverviewNode[];
}

function compareItems(left: ThreadOverviewItem, right: ThreadOverviewItem): number {
	return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

export function buildThreadOverviewTree(
	items: readonly ThreadOverviewItem[],
	selectedStatuses: ReadonlySet<string>,
): ThreadOverviewNode[] {
	if (selectedStatuses.size === 0) return [];
	const byId = new Map(items.map((item) => [item.id, item]));
	const included = new Set<string>();
	for (const item of items) {
		if (!selectedStatuses.has(item.status)) continue;
		const lineage = new Set<string>();
		let cursor: ThreadOverviewItem | undefined = item;
		while (cursor && !lineage.has(cursor.id)) {
			lineage.add(cursor.id);
			included.add(cursor.id);
			cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
		}
	}

	const includedItems = items.filter((item) => included.has(item.id));
	const children = new Map<string, ThreadOverviewItem[]>();
	for (const item of includedItems) {
		if (!item.parent || !included.has(item.parent) || item.parent === item.id) continue;
		children.set(item.parent, [...(children.get(item.parent) ?? []), item]);
	}
	for (const values of children.values()) values.sort(compareItems);

	const claimed = new Set<string>();
	const buildNode = (item: ThreadOverviewItem): ThreadOverviewNode | undefined => {
		if (claimed.has(item.id)) return undefined;
		claimed.add(item.id);
		return {
			item,
			contextOnly: !selectedStatuses.has(item.status),
			children: (children.get(item.id) ?? [])
				.map(buildNode)
				.filter((node): node is ThreadOverviewNode => Boolean(node)),
		};
	};

	const naturalRoots = includedItems
		.filter((item) => !item.parent || !included.has(item.parent) || item.parent === item.id)
		.sort(compareItems);
	const roots = naturalRoots
		.map(buildNode)
		.filter((node): node is ThreadOverviewNode => Boolean(node));
	for (const item of [...includedItems].sort(compareItems)) {
		const root = buildNode(item);
		if (root) roots.push(root);
	}
	return roots;
}
