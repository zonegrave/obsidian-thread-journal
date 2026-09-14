function aliasValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.filter((item): item is string => typeof item === 'string')
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

export function replaceThreadDisplayAlias(value: unknown, title: string): string[] {
	const displayTitle = title.trim();
	if (!displayTitle) return aliasValues(value);
	const aliases = aliasValues(value);
	return [
		displayTitle,
		...aliases.slice(1).filter((alias) => alias !== displayTitle),
	];
}
