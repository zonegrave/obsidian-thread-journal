export function buildThreadFileName(title: string, collisionKey?: string): string {
	const safeTitle = title
		.trim()
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\.+$/g, '')
		.trim();
	if (!safeTitle) return '';
	const suffix = collisionKey?.replace(/[^a-z0-9]/gi, '').slice(0, 8);
	return suffix ? `${safeTitle}·${suffix}` : safeTitle;
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
