export function buildThreadFileName(title: string, datePrefix: string): string {
	const safeTitle = title
		.trim()
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\.+$/g, '')
		.trim();
	return safeTitle ? `${datePrefix}·${safeTitle}` : '';
}

export function normalizeWorkspaceSuffix(value: unknown, fallback = '工作区'): string {
	const safeSuffix = (typeof value === 'string' ? value : '')
		.trim()
		.replace(/^·+/g, '')
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\.+$/g, '')
		.trim();
	return safeSuffix || fallback;
}

export function buildWorkspaceFileName(
	threadBaseName: string,
	suffix = '工作区',
): string {
	return `${threadBaseName}·${normalizeWorkspaceSuffix(suffix)}`;
}

export function buildWorkspaceBody(threadTitle: string): string {
	const title = threadTitle.replace(/[\n\r]+/g, ' ').trim();
	return `# ${title} · Thread 工作区\n`;
}

export function stripWikiLink(value: unknown): string | undefined {
	if (Array.isArray(value)) return stripWikiLink(value[0]);
	if (typeof value !== 'string') return undefined;
	let link = value.trim();
	if (!link) return undefined;
	if (link.startsWith('[[') && link.endsWith(']]')) link = link.slice(2, -2);
	link = link.split('|', 1)[0]?.split('#', 1)[0]?.trim() ?? '';
	return link || undefined;
}

export function wikiLinkAlias(value: unknown): string | undefined {
	if (Array.isArray(value)) return wikiLinkAlias(value[0]);
	if (typeof value !== 'string') return undefined;
	let link = value.trim();
	if (!link) return undefined;
	if (link.startsWith('[[') && link.endsWith(']]')) link = link.slice(2, -2);
	const separator = link.indexOf('|');
	if (separator < 0) return undefined;
	const alias = link.slice(separator + 1).trim();
	return alias || undefined;
}
