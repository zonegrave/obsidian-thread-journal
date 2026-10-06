import { TFile, type App, type Plugin } from 'obsidian';
import { buildTaskLine, completeTaskData, releaseTaskHolding, type TaskData } from './task-model';
import { holdingResult, scanTaskLines, type TaskLookup } from './task-holding-model';
import type { FileTaskLocation } from './task';

export async function readTaskLocations(app: App): Promise<FileTaskLocation[]> {
	const files = await Promise.all(app.vault.getMarkdownFiles().map(async file =>
		scanTaskLines(await app.vault.cachedRead(file)).map(task => ({ ...task, file }))));
	return files.flat();
}

export function taskLookup(locations: readonly FileTaskLocation[]): TaskLookup {
	const result = new Map<string, TaskData[]>();
	for (const task of locations) {
		const data = task.parsed.data;
		if (data.taskId) result.set(data.taskId, [...(result.get(data.taskId) ?? []), data]);
	}
	return result;
}

// Writes only a freshly verified task line. No writes occur in renderers or query paths.
export class TaskHoldingService {
	private timer?: number;
	private running = false;
	private dirty = false;
	private stopped = false;
	private revision = 0;

	constructor(private readonly app: App, private readonly invalidate: () => void) {}

	register(plugin: Plugin): void {
		const changed = (): void => { this.revision++; this.invalidate(); this.schedule(); };
		plugin.registerEvent(this.app.vault.on('modify', file => { if (file instanceof TFile && file.extension === 'md') changed(); }));
		plugin.registerEvent(this.app.vault.on('create', changed));
		plugin.registerEvent(this.app.vault.on('delete', changed));
		plugin.registerEvent(this.app.vault.on('rename', changed));
		this.app.workspace.onLayoutReady(() => this.schedule());
		plugin.register(() => {
			this.stopped = true;
			if (this.timer !== undefined) window.clearTimeout(this.timer);
		});
	}

	private schedule(): void {
		if (this.stopped) return;
		this.dirty = true;
		if (this.running) return;
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = undefined;
			void this.reconcile().catch(error => console.error('Thread Journal holding reconciliation failed', error));
		}, 300);
	}

	async reconcile(): Promise<void> {
		if (this.running || this.stopped) return;
		this.running = true;
		this.dirty = false;
		try {
			const revision = this.revision;
			const locations = await readTaskLocations(this.app);
			const lookup = taskLookup(locations);
			if (revision !== this.revision || this.stopped) { this.dirty = true; return; }
			for (const task of locations) {
				if (this.stopped || revision !== this.revision) { this.dirty = true; break; }
				const data = task.parsed.data;
				if (!data.taskId || lookup.get(data.taskId)?.length !== 1) continue;
				let updated = data;
				if (data.status === 'completed') updated = completeTaskData(data);
				else if (data.status !== 'cancelled' && holdingResult(data, lookup) === 'ready') updated = releaseTaskHolding(data);
				if (JSON.stringify(updated) === JSON.stringify(data)) continue;
				await this.app.vault.process(task.file, content => {
					if (this.stopped || revision !== this.revision) { this.dirty = true; return content; }
					const matches = scanTaskLines(content).filter(item => item.parsed.data.taskId === data.taskId);
					if (matches.length !== 1 || matches[0]!.sourceLine !== task.sourceLine) return content;
					const lines = content.split('\n');
					lines[matches[0]!.line] = buildTaskLine(updated, matches[0]!.parsed);
					return lines.join('\n');
				});
				this.invalidate();
			}
		} finally {
			this.running = false;
			if (this.dirty) this.schedule();
		}
	}
}
