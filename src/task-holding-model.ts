import { parseTaskLine, validDate, type TaskData, type ParsedTaskLine } from './task-model';

export type TaskLookup = ReadonlyMap<string, readonly TaskData[]>;
export type HoldingResult = 'manual' | 'pending' | 'ready' | 'invalid';

export function parseDependency(value: string): { id: string; occurrence: string } | undefined {
	const match = /^(task-[a-z0-9]{12})(?:@(\d{4}-\d{2}-\d{2}))?$/u.exec(value);
	if (!match || (match[2] && !validDate(match[2]))) return undefined;
	return { id: match[1]!, occurrence: match[2] ?? '' };
}

export function dependencyReference(data: TaskData): string {
	return data.taskId + (data.repeat ? `@${data.current}` : '');
}

// This graph also validates edges entered by hand, not just the picker.
export function holdingGraphError(data: TaskData, tasks: TaskLookup): boolean {
	const visit = (node: TaskData, path: Set<string>): boolean => {
		if (path.has(node.taskId)) return true;
		const next = new Set(path).add(node.taskId);
		for (const ref of node.holding ? node.holdingFor : []) {
			const dependency = parseDependency(ref);
			if (!dependency) return true;
			if (next.has(dependency.id)) return true;
			const targets = tasks.get(dependency.id);
			if (targets?.length !== 1) return true;
			const target = targets[0]!;
			if (target.repeat && !dependency.occurrence) return true;
			if (visit(target, next)) return true;
		}
		return false;
	};
	return visit(data, new Set());
}

export function holdingResult(data: TaskData, tasks: TaskLookup): HoldingResult {
	if (!data.holding || !data.holdingFor.length) return 'manual';
	if (holdingGraphError(data, tasks)) return 'invalid';
	let pending = false;
	for (const ref of data.holdingFor) {
		const dependency = parseDependency(ref)!;
		const target = tasks.get(dependency.id)![0]!;
		if (target.status === 'cancelled') return 'invalid';
		const completed = dependency.occurrence
			? target.completedOccurrences.includes(dependency.occurrence)
				|| (target.status === 'completed' && target.current === dependency.occurrence)
			: target.status === 'completed';
		if (!completed) pending = true;
	}
	return pending ? 'pending' : 'ready';
}

// Avoid treating code samples, frontmatter or indented code as real dependencies.
export function scanTaskLines(content: string): { line: number; sourceLine: string; parsed: ParsedTaskLine }[] {
	const result: { line: number; sourceLine: string; parsed: ParsedTaskLine }[] = [];
	let frontmatter = false;
	let fence = '';
	let fenceLength = 0;
	const listContentIndents: number[] = [];
	const lines = content.split('\n');
	for (let line = 0; line < lines.length; line++) {
		const sourceLine = lines[line]!;
		if (line === 0 && sourceLine.trim() === '---') { frontmatter = true; continue; }
		if (frontmatter) {
			if (/^(---|\.\.\.)\s*$/u.test(sourceLine)) frontmatter = false;
			continue;
		}
		const body = sourceLine.replace(/^\s*(?:>\s*)+/u, '');
		const code = /^\s*(`{3,}|~{3,})(.*)$/u.exec(body);
		if (code) {
			if (!fence) { fence = code[1]![0]!; fenceLength = code[1]!.length; }
			else if (code[1]![0] === fence && code[1]!.length >= fenceLength && !code[2]!.trim()) fence = '';
			continue;
		}
		if (fence) continue;
		const indent = /^\s*/u.exec(body)![0].replaceAll('\t', '    ').length;
		if (!body.trim()) continue;
		while (listContentIndents.length && indent < listContentIndents[listContentIndents.length - 1]!) listContentIndents.pop();
		const parentIndent = listContentIndents[listContentIndents.length - 1] ?? 0;
		if (indent >= parentIndent + 4) continue;
		const list = /^\s*(?:[-*+]|\d+[.)])\s+/u.exec(body);
		if (list) listContentIndents.push(list[0].replaceAll('\t', '    ').length);
		const parsed = parseTaskLine(sourceLine);
		if (parsed) result.push({ line, sourceLine, parsed });
	}
	return result;
}
