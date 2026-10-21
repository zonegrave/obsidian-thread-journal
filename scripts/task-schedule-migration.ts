// One-time source migration; never imported by the plugin runtime.
import { scanTaskLines } from '../src/task-holding-model';
import { validDate } from '../src/task-model';

export function migrateTaskSchedule(content: string): { content: string; changedLines: number[] } {
	const lines = content.split('\n');
	const changedLines: number[] = [];
	for (const task of scanTaskLines(content)) {
		let line = task.sourceLine;
		const previous = /\[current::\s*([^\]]*)\]/u.exec(line);
		const scheduled = /\[scheduled::\s*([^\]]*)\]/u.exec(line);
		if (previous) {
			const value = previous[1]!.trim();
			if (!validDate(value)) throw new Error(`Invalid execution date at line ${task.line + 1}`);
			if (scheduled && scheduled[1]!.trim() !== value) throw new Error(`Conflicting execution dates at line ${task.line + 1}`);
			line = scheduled ? line.replace(/\s*\[current::[^\]]*\]/gu, '') : line.replace(/\[current::/gu, '[scheduled::');
		}
		if (/\[scheduled::\s*\d{4}-\d{2}-\d{2}\s*\]/u.test(line)) line = line.replace(/\s*\[thread_pin::\s*true\]/giu, '');
		if (line === task.sourceLine) continue;
		lines[task.line] = line;
		changedLines.push(task.line + 1);
	}
	return { content: lines.join('\n'), changedLines };
}
