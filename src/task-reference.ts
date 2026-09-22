import {
	App,
	MarkdownRenderChild,
	MarkdownRenderer,
	moment,
	setIcon,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import { t } from './i18n';
import {
	TASK_EFFORT_LABELS,
	taskDeadlineDisplay,
	taskNextActionLabel,
	taskRepeatRuleDisplay,
} from './task-display';
import { parseTaskReference } from './task-reference-model';
import { taskCurrentLabel } from './task-model';
import type { FileTaskLocation, TaskManager } from './task';

class TaskReferenceRenderer extends MarkdownRenderChild {
	private request = 0;
	private timer?: number;

	constructor(
		containerEl: HTMLElement,
		private readonly app: App,
		private readonly taskManager: TaskManager,
		private readonly taskId: string,
	) {
		super(containerEl);
	}

	onload(): void {
		this.containerEl.addClass('thread-journal-task-reference');
		this.registerEvent(this.app.metadataCache.on('changed', () => {
			this.taskManager.invalidateTaskIndex();
			this.scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on('delete', () => {
			this.taskManager.invalidateTaskIndex();
			this.scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on('rename', () => {
			this.taskManager.invalidateTaskIndex();
			this.scheduleRefresh();
		}));
		void this.refresh();
	}

	onunload(): void {
		this.request += 1;
		if (this.timer !== undefined) window.clearTimeout(this.timer);
	}

	private scheduleRefresh(): void {
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = undefined;
			void this.refresh();
		}, 200);
	}

	private async refresh(): Promise<void> {
		const request = ++this.request;
		const matches = await this.taskManager.findTasksById(this.taskId);
		if (request !== this.request || !this.containerEl.isConnected) return;
		this.containerEl.empty();
		if (matches.length === 0) {
			this.renderMessage(t('Task not found: {id}', { id: this.taskId }));
			return;
		}
		if (matches.length > 1) {
			this.renderMessage(t('Task ID is duplicated: {id}', { id: this.taskId }));
			return;
		}
		await this.renderTask(matches[0]!);
	}

	private renderMessage(message: string): void {
		this.containerEl.createDiv({ cls: 'thread-journal-task-reference-message', text: message });
	}

	private async renderTask(task: FileTaskLocation): Promise<void> {
		const { data } = task.parsed;
		const completed = task.parsed.marker.toLowerCase() === 'x' || task.parsed.marker === '-';
		const card = this.containerEl.createDiv({
			cls: `thread-journal-task-reference-card${completed ? ' is-completed' : ''}`,
		});
		const checkbox = card.createEl('input', {
			cls: 'task-list-item-checkbox thread-journal-task-reference-checkbox',
			attr: { type: 'checkbox', 'aria-label': t('Toggle task completion') },
		});
		checkbox.checked = completed;
		checkbox.addEventListener('change', () => {
			checkbox.disabled = true;
			void this.taskManager.setFileTaskCompleted(
				task.file,
				task.line,
				task.sourceLine,
				checkbox.checked,
			).then(() => this.refresh()).catch(() => {
				checkbox.checked = completed;
				checkbox.disabled = false;
			});
		});

		let pinned = data.pinned;
		const pin = card.createEl('button', {
			cls: `clickable-icon thread-journal-task-reference-pin${pinned ? ' is-pinned' : ''}`,
			attr: { type: 'button' },
		});
		const updatePin = (): void => {
			pin.toggleClass('is-pinned', pinned);
			pin.setAttribute('aria-pressed', String(pinned));
			const label = pinned ? t('Unpin task') : t('Pin task');
			pin.setAttribute('aria-label', label);
			pin.setAttribute('title', label);
			pin.empty();
			setIcon(pin, pinned ? 'pin-off' : 'pin');
		};
		updatePin();
		pin.addEventListener('click', () => {
			pin.disabled = true;
			void this.taskManager.setFileTaskPinned(task.file, task.line, task.sourceLine, !pinned)
				.then(() => {
					pinned = !pinned;
					updatePin();
					this.scheduleRefresh();
				})
				.catch(() => undefined)
				.finally(() => {
					if (pin.isConnected) pin.disabled = false;
				});
		});

		const body = card.createDiv({ cls: 'thread-journal-task-reference-body' });
		const content = body.createDiv({ cls: 'thread-journal-task-reference-content' });
		await MarkdownRenderer.render(this.app, data.content, content, task.file.path, this);

		const details = body.createDiv({ cls: 'thread-journal-task-reference-details' });
		const addDetail = (text: string, icon: string, modifier = ''): void => {
			const detail = details.createSpan({
				cls: `thread-journal-task-reference-detail${modifier ? ` is-${modifier}` : ''}`,
			});
			setIcon(detail.createSpan({ cls: 'thread-journal-task-chip-icon' }), icon);
			detail.createSpan({ text });
		};
		const today = moment().format('YYYY-MM-DD');
		const deadline = taskDeadlineDisplay(data, today);
		if (deadline) addDetail(deadline.label, 'calendar-clock', deadline.modifier);
		if (data.effort) {
			const label = t(TASK_EFFORT_LABELS[data.effort]);
			const effort = details.createSpan({
				cls: `thread-journal-task-effort is-${data.effort}`,
				attr: { title: label, 'aria-label': label },
			});
			setIcon(effort, 'gauge');
		}
		if (data.repeat) {
			const rule = taskRepeatRuleDisplay(data);
			const nextLabel = taskNextActionLabel(data, today);
			const current = taskCurrentLabel(data.current, today, t('Today'));
			const repeat = details.createSpan({
				cls: 'thread-journal-task-reference-repeat',
				attr: { title: rule },
			});
			const next = repeat.createEl('button', {
				cls: 'clickable-icon thread-journal-task-repeat-next',
				attr: {
					type: 'button',
					'aria-label': `${rule} · ${nextLabel}`,
					title: `${rule} · ${nextLabel}`,
				},
			});
			setIcon(next, 'repeat-2');
			if (current) repeat.createSpan({ text: current });
			next.addEventListener('click', () => {
				next.disabled = true;
				this.taskManager.moveFileTaskToNext(
					task.file,
					task.line,
					task.sourceLine,
					() => void this.refresh(),
				);
			});
		}
		if (!details.hasChildNodes()) details.remove();

		const actions = card.createDiv({ cls: 'thread-journal-task-reference-actions' });
		const commit = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-task-commit',
			attr: { type: 'button', 'aria-label': t('Create commit from task'), title: t('Create commit from task') },
		});
		setIcon(commit, 'git-commit-horizontal');
		commit.addEventListener('click', () => {
			this.taskManager.openFileTaskCommit(
				task.file,
				task.line,
				task.sourceLine,
				data,
				undefined,
				() => this.scheduleRefresh(),
			);
		});
		const source = actions.createEl('button', {
			cls: 'clickable-icon',
			attr: {
				type: 'button',
				'aria-label': t('Open source task'),
				title: t('Open source task'),
			},
		});
		setIcon(source, 'locate-fixed');
		source.addEventListener('click', () => {
			void this.app.workspace.getLeaf(false).openFile(task.file, {
				eState: { line: task.line },
			});
		});
		const edit = actions.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': t('Edit task'), title: t('Edit task') },
		});
		setIcon(edit, 'pencil');
		edit.addEventListener('click', () => {
			this.taskManager.openFileTaskEdit(
				task.file,
				task.line,
				task.sourceLine,
				data,
				() => this.scheduleRefresh(),
			);
		});
	}
}

export function renderTaskReference(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	app: App,
	taskManager: TaskManager,
): void {
	const taskId = parseTaskReference(source);
	if (!taskId) {
		el.addClass('thread-journal-task-reference');
		el.createDiv({
			cls: 'thread-journal-task-reference-message',
			text: t('Enter a valid task ID.'),
		});
		return;
	}
	ctx.addChild(new TaskReferenceRenderer(el, app, taskManager, taskId));
}
