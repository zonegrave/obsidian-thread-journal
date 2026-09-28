// One-time migration only. Not imported by the plugin runtime.
import { scanTaskLines } from '../src/task-holding-model';

export function migrateTaskStates(content: string): { content: string; changedLines: number[] } {
	const lines = content.split('\n');
	const changedLines: number[] = [];
	for (const task of scanTaskLines(content)) {
		if (!['i', ':', '?', '>'].includes(task.parsed.marker)) continue;
		let line = task.sourceLine;
		const offset = task.parsed.prefix.length;
		const marker = task.parsed.marker === 'i'
			? '!'
			: task.parsed.marker === ':' || task.parsed.marker === '?'
				? '+'
				: ' ';
		line = line.slice(0, offset) + marker + line.slice(offset + 1);
		if (task.parsed.marker === '>') {
			line = line.replace(/\s*\[holding::\s*[^\]]*\]/gu, '');
			const block = /\s+(\^[\p{Letter}\p{Number}_-]+)\s*$/u.exec(line);
			line = block
				? `${line.slice(0, block.index)} [holding:: true] ${block[1]}`
				: `${line.trimEnd()} [holding:: true]`;
		}
		lines[task.line] = line;
		changedLines.push(task.line + 1);
	}
	return { content: lines.join('\n'), changedLines };
}
