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

export function breadcrumbCounterpart(
	threadPath: string,
	workspacePath: string | undefined,
	currentPath: string,
): { path: string; label: string } | undefined {
	if (!workspacePath) return undefined;
	return currentPath === workspacePath
		? { path: threadPath, label: '返回主 thread' }
		: { path: workspacePath, label: '打开工作区' };
}
