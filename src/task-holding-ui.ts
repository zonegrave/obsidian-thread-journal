import { App, FuzzySuggestModal, Modal, Notice, Setting, moment } from 'obsidian';
import { t, type TranslationKey } from './i18n';
import { releaseTaskHolding, type TaskData, type TaskStatus } from './task-model';
import { dependencyReference, holdingGraphError, holdingResult, parseDependency } from './task-holding-model';
import { readTaskLocations, taskLookup } from './task-holding';
import type { FileTaskLocation, TaskManager } from './task';

export const TASK_STATUS_LABELS: Record<TaskStatus, TranslationKey> = {
	idea: 'Idea', committed: 'Committed', open: 'Open', completed: 'Completed', cancelled: 'Cancelled',
};

class DependencyPicker extends FuzzySuggestModal<FileTaskLocation> {
	constructor(app: App, private readonly items: FileTaskLocation[], private readonly choose: (item: FileTaskLocation) => void) {
		super(app);
		this.setPlaceholder(t('Select a dependency task'));
	}
	getItems(): FileTaskLocation[] { return this.items; }
	getItemText(item: FileTaskLocation): string {
		return `${item.parsed.data.content} · ${item.file.basename} · ${item.parsed.data.current || item.parsed.data.taskId}`;
	}
	onChooseItem(item: FileTaskLocation): void { this.choose(item); }
}

export function renderHoldingFields(app: App, parent: HTMLElement, data: TaskData, render: () => void): void {
	const section = parent.createDiv({ cls: 'thread-journal-holding-fields' });
	new Setting(section).setName(t('Holding')).setDesc(t('Keep the task state and move it out of its decision queue.'))
		.addToggle(toggle => toggle.setValue(data.holding).onChange(value => {
			Object.assign(data, value ? { holding: true } : releaseTaskHolding(data));
			render();
		}));
	if (!data.holding) return;
	new Setting(section).setName(t('Next review')).setDesc(t('Optional reminder; reaching this date does not release holding.'))
		.addText(text => {
			text.inputEl.type = 'date';
			text.setValue(data.holdingReview).onChange(value => { data.holdingReview = value; });
		});
	new Setting(section).setName(t('Holding for')).setDesc(t('All dependencies must complete. Without dependencies, release manually.'))
		.addButton(button => button.setButtonText(t('Add dependency')).onClick(async () => {
			try {
				const locations = await readTaskLocations(app);
				const lookup = taskLookup(locations);
				const candidates = locations.filter(item => {
					const target = item.parsed.data;
					const ref = dependencyReference(target);
					return target.taskId && lookup.get(target.taskId)?.length === 1
						&& target.status !== 'cancelled' && !data.holdingFor.includes(ref)
						&& !holdingGraphError({ ...data, holdingFor: [...data.holdingFor, ref] }, lookup);
				});
				new DependencyPicker(app, candidates, item => {
					data.holdingFor = [...data.holdingFor, dependencyReference(item.parsed.data)];
					render();
				}).open();
			} catch (error) { new Notice(String(error)); }
		}));
	const list = section.createDiv();
	const locations = data.holdingFor.length ? readTaskLocations(app) : Promise.resolve([]);
	for (const ref of data.holdingFor) {
		const row = new Setting(list).setName(ref).addButton(button => button.setButtonText(t('Remove dependency')).onClick(() => {
			data.holdingFor = data.holdingFor.filter(value => value !== ref);
			render();
		}));
		void readDependencyLabel(locations, ref).then(label => { if (list.isConnected) row.setName(label); }).catch(() => { if (list.isConnected) row.setName(t('Dependency needs attention')); });
	}
	new Setting(section).addButton(button => button.setButtonText(t('Release holding')).onClick(() => {
		Object.assign(data, releaseTaskHolding(data));
		render();
	}));
}

async function readDependencyLabel(locations: Promise<FileTaskLocation[]>, ref: string): Promise<string> {
	const dependency = parseDependency(ref);
	if (!dependency) return `${t('Dependency needs attention')} · ${ref}`;
	const matches = (await locations).filter(item => item.parsed.data.taskId === dependency.id);
	return matches.length === 1
		? `${matches[0]!.parsed.data.content}${dependency.occurrence ? ` · ${dependency.occurrence}` : ''}`
		: `${t('Dependency needs attention')} · ${ref}`;
}

export class HoldingQueueModal extends Modal {
	private refreshId = 0;
	constructor(app: App, private readonly manager: TaskManager) { super(app); }
	onOpen(): void {
		this.modalEl.addClass('thread-journal-holding-modal');
		this.setTitle(t('Holding queue'));
		void this.refresh();
	}
	onClose(): void { this.refreshId++; this.contentEl.empty(); }
	private async refresh(): Promise<void> {
		const id = ++this.refreshId;
		try {
			const locations = await readTaskLocations(this.app);
			if (id !== this.refreshId) return;
			const lookup = taskLookup(locations);
			const today = moment().format('YYYY-MM-DD');
			const tasks = locations.filter(({ parsed: { data } }) => data.holding && !['completed', 'cancelled'].includes(data.status))
				.sort((a, b) => (a.parsed.data.holdingReview || '9999').localeCompare(b.parsed.data.holdingReview || '9999'));
			this.contentEl.empty();
			new Setting(this.contentEl).addButton(button => button.setButtonText(t('Refresh')).onClick(() => this.refresh()));
			if (!tasks.length) this.contentEl.createEl('p', { text: t('No held tasks.') });
			for (const task of tasks) {
				const data = task.parsed.data;
				const card = this.contentEl.createDiv({ cls: 'thread-journal-holding-card' });
				const due = data.holdingReview && data.holdingReview <= today;
				const result = holdingResult(data, lookup);
				const description = [t(TASK_STATUS_LABELS[data.status]), task.file.basename,
					data.holdingReview ? `${due ? t('Review due') : t('Next review')}: ${data.holdingReview}` : '',
					result === 'invalid' ? t('Dependency needs attention') : data.holdingFor.length ? t('Waiting for dependencies') : t('Manual confirmation'),
				].filter(Boolean).join(' · ');
				new Setting(card).setName(data.content).setDesc(description)
					.addButton(button => button.setButtonText(t('Edit task')).onClick(() => {
						this.manager.openFileTaskEdit(task.file, task.line, task.sourceLine, data, () => void this.refresh());
					}))
					.addButton(button => button.setButtonText(t('Release holding')).onClick(async () => {
						try { await this.manager.releaseHolding(task); await this.refresh(); }
						catch (error) { new Notice(String(error)); }
					}));
				for (const ref of data.holdingFor) {
					const dependency = parseDependency(ref);
					const matches = dependency ? locations.filter(item => item.parsed.data.taskId === dependency.id) : [];
					const target = matches.length === 1 ? matches[0] : undefined;
					card.createDiv({ text: `${target?.parsed.data.content ?? ref}${dependency?.occurrence ? ` · ${dependency.occurrence}` : ''}` });
				}
			}
		} catch (error) { new Notice(String(error)); }
	}
}
