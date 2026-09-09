import type { ThreadInfo } from './types';

export type BreadcrumbFilter = 'active' | 'all';
export type BreadcrumbPosition = 'top' | 'bottom';

export function filterBreadcrumbThreads(
	threads: ThreadInfo[],
	filter: BreadcrumbFilter,
): ThreadInfo[] {
	return threads
		.filter((thread) => filter === 'all' || thread.status === 'active')
		.sort((left, right) => left.title.localeCompare(right.title));
}

export function breadcrumbFilterLabel(filter: BreadcrumbFilter): string {
	return filter === 'active' ? '持续关注' : '全部';
}
