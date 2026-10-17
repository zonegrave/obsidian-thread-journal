export const ROOT_THREAD_ID = 'ROOT';

export function rootThreadPath(folder: string): string {
	return [...folder.split('/').filter(Boolean), 'ROOT.md'].join('/');
}

export function rootThreadContent(created: string): string {
	return `---\ntype: thread\nthread_id: ROOT\naliases:\n  - ROOT\nstatus: active\ncreated: ${created}\n---\n`;
}

export function rootThreadSettingsValid(title: string, status: string, parentId: string): boolean {
	return title === ROOT_THREAD_ID && status === 'active' && !parentId;
}
