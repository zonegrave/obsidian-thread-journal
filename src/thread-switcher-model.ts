import type { ThreadRoleStatus } from './types';

export interface ThreadRoleTarget {
	path: string;
	status: ThreadRoleStatus;
}

export function nextActiveThreadRolePath(
	targets: ThreadRoleTarget[],
	currentPath: string,
): string | undefined {
	const active = targets.filter((target) => target.status === 'active');
	if (active.length === 0) return undefined;
	const currentIndex = active.findIndex((target) => target.path === currentPath);
	return currentIndex >= 0
		? active[(currentIndex + 1) % active.length]?.path
		: active[0]?.path;
}
