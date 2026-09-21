export function moveCheckpointOption(
	options: readonly string[],
	from: number,
	to: number,
): string[] {
	if (
		from < 0
		|| from >= options.length
		|| to < 0
		|| to >= options.length
		|| from === to
	) return [...options];
	const next = [...options];
	const [moved] = next.splice(from, 1);
	if (moved === undefined) return [...options];
	next.splice(to, 0, moved);
	return next;
}
