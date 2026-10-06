// Read an exported note from stdin; emit migrated Markdown. Never writes into a vault.
import process from 'node:process';
import { migrateTaskStates } from './task-state-migration';
let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => { source += chunk; });
process.stdin.on('end', () => {
	const result = migrateTaskStates(source);
	process.stderr.write(`Changed lines: ${result.changedLines.join(', ') || 'none'}\n`);
	process.stdout.write(result.content);
});
