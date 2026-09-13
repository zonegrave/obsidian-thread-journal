import type { ThreadInfo } from './types';
import { isOperationalThreadStatus } from './thread-status-model';

export type BreadcrumbPosition = 'top' | 'bottom';

export function breadcrumbTooltipPlacement(position: BreadcrumbPosition): 'top' | 'bottom' {
	return position === 'bottom' ? 'top' : 'bottom';
}

export function filterBreadcrumbThreads(
	threads: ThreadInfo[],
): ThreadInfo[] {
	return threads
		.filter((thread) => isOperationalThreadStatus(thread.status))
		.sort((left, right) => left.title.localeCompare(right.title));
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

export interface BreadcrumbRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export function breadcrumbRightClearance(
	bar: BreadcrumbRect,
	overlay: BreadcrumbRect,
	gap = 8,
): number {
	const verticalOverlap = Math.min(bar.bottom, overlay.bottom) - Math.max(bar.top, overlay.top);
	const horizontalOverlap = Math.min(bar.right, overlay.right) - Math.max(bar.left, overlay.left);
	if (verticalOverlap <= 0 || horizontalOverlap <= 0) return 0;
	return Math.max(0, bar.right - Math.max(bar.left, overlay.left)) + gap;
}
