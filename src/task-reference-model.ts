const TASK_ID = /^task-[a-z0-9]{12}$/u;

export function parseTaskReference(source: string): string | undefined {
	const normalized = source.trim();
	const field = /^reference_task_id\s*:\s*(task-[a-z0-9]{12})\s*$/u.exec(normalized);
	if (field?.[1] && TASK_ID.test(field[1])) return field[1];
	const inline = /^\[reference_task_id::\s*(task-[a-z0-9]{12})\s*\]$/u.exec(normalized);
	return inline?.[1];
}
