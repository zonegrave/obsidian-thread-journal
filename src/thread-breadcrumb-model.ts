import type { ThreadInfo } from './types';
import { isOperationalThreadStatus } from './thread-status-model';

export type BreadcrumbFilter = 'operational' | 'all';
export type BreadcrumbPosition = 'top' | 'bottom';

export function filterBreadcrumbThreads(
	threads: ThreadInfo[],
	filter: BreadcrumbFilter,
): ThreadInfo[] {
	return threads
		.filter((thread) => filter === 'all' || isOperationalThreadStatus(thread.status))
		.sort((left, right) => left.title.localeCompare(right.title));
}

export function breadcrumbFilterLabel(filter: BreadcrumbFilter): string {
	return filter === 'operational' ? '投入中' : '全部';
}

export function breadcrumbMenuSide(
	triggerTop: number,
	triggerBottom: number,
	viewportHeight: number,
	menuHeight: number,
	preferAbove: boolean,
): 'above' | 'below' {
	if (preferAbove) return 'above';
	const spaceAbove = triggerTop;
	const spaceBelow = viewportHeight - triggerBottom;
	return spaceBelow < Math.min(menuHeight, 240) && spaceAbove > spaceBelow ? 'above' : 'below';
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
