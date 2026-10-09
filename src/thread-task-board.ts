import {
	App,
	ItemView,
	Notice,
	moment,
	setIcon,
	type WorkspaceLeaf,
} from 'obsidian';
import {
	collectAttention,
	type AttentionRow,
	type AttentionRowTask,
} from './thread-attention';
import type { ThreadIndex } from './thread-index';
import type { TaskManager } from './task';
import {
	TASK_EFFORT_LABELS,
	TASK_STATUS_ICONS,
	TASK_STATUS_LABELS,
	taskDeadlineDisplay,
	taskHoldingDisplay,
	taskRepeatRuleDisplay,
} from './task-display';
import { taskCurrentLabel, type TaskStatus } from './task-model';
import type { ThreadInfo } from './types';
import { LANGUAGE_CHANGE_EVENT, t } from './i18n';

export const THREAD_TASK_BOARD_VIEW_TYPE = 'thread-journal-task-board';

const BOARD_STATUSES: TaskStatus[] = ['idea', 'committed', 'open'];

interface BoardTask {
	task: AttentionRowTask;
	threads: ThreadInfo[];
}

function collectBoardTasks(rows: AttentionRow[]): BoardTask[] {
	const tasks = new Map<string, BoardTask>();
	for (const row of rows) {
		for (const task of row.tasks) {
			if (!BOARD_STATUSES.includes(task.data.status)) continue;
			const current = tasks.get(task.key);
			if (current) {
				if (!current.threads.some((thread) => thread.id === row.thread.id)) {
					current.threads.push(row.thread);
				}
				continue;
			}
			tasks.set(task.key, { task, threads: [row.thread] });
		}
	}
	return [...tasks.values()].sort((left, right) => {
		const pinOrder = Number(right.task.pinned) - Number(left.task.pinned);
		if (pinOrder) return pinOrder;
		const leftDate = left.task.data.windowEnd
			|| left.task.data.windowStart
			|| left.task.data.current
			|| '9999-99-99';
		const rightDate = right.task.data.windowEnd
			|| right.task.data.windowStart
			|| right.task.data.current
			|| '9999-99-99';
		return leftDate.localeCompare(rightDate)
			|| left.task.text.localeCompare(right.task.text);
	});
}

export class ThreadTaskBoardView extends ItemView {
	private rows: AttentionRow[] = [];
	private request = 0;
	private timer: number | undefined;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly index: ThreadIndex,
		private readonly taskManager: TaskManager,
	) {
		super(leaf);
	}

	getViewType(): string {
		return THREAD_TASK_BOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('Thread task board');
	}

	getIcon(): string {
		return 'columns-3';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('thread-journal-task-board-view');
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		const onLanguageChange = (): void => this.render();
		window.addEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange);
		this.register(() => window.removeEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange));
		this.registerInterval(window.setInterval(() => this.scheduleRefresh(), 60000));
		this.renderLoading();
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.request += 1;
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.contentEl.empty();
		this.contentEl.removeClass('thread-journal-task-board-view');
	}

	private renderLoading(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			cls: 'thread-journal-empty',
			text: t('Loading thread task board…'),
		});
	}

	private scheduleRefresh(): void {
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = undefined;
			void this.refresh();
		}, 300);
	}

	private async refresh(): Promise<void> {
		const request = ++this.request;
		try {
			const rows = await collectAttention(this.app, this.index);
			if (request !== this.request) return;
			this.rows = rows;
			this.render();
		} catch (error) {
			if (request !== this.request) return;
			this.contentEl.empty();
			this.contentEl.createEl('p', {
				cls: 'thread-journal-empty',
				text: t('Failed to read thread task board: {error}', { error: String(error) }),
			});
		}
	}

	private render(): void {
		const tasks = collectBoardTasks(this.rows);
		this.contentEl.empty();
		const header = this.contentEl.createDiv({ cls: 'thread-journal-task-board-header' });
		header.createEl('h2', { text: t('Thread task board') });
		header.createSpan({
			cls: 'thread-journal-task-board-total',
			text: t('{count} tasks', { count: tasks.length }),
		});
		const refresh = header.createEl('button', {
			cls: 'clickable-icon thread-journal-task-board-refresh',
			attr: { type: 'button', 'aria-label': t('Refresh'), title: t('Refresh') },
		});
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => {
			refresh.disabled = true;
			void this.refresh();
		});

		const board = this.contentEl.createDiv({ cls: 'thread-journal-task-board' });
		for (const status of BOARD_STATUSES) {
			this.renderColumn(board, status, tasks.filter((item) => item.task.data.status === status));
		}
	}

	private renderColumn(parent: HTMLElement, status: TaskStatus, tasks: BoardTask[]): void {
		const column = parent.createEl('section', {
			cls: `thread-journal-task-board-column is-${status}`,
		});
		const header = column.createDiv({ cls: 'thread-journal-task-board-column-header' });
		setIcon(header.createSpan({ cls: 'thread-journal-task-board-column-icon' }), TASK_STATUS_ICONS[status]);
		header.createEl('h3', { text: t(TASK_STATUS_LABELS[status]) });
		header.createSpan({
			cls: 'thread-journal-task-board-count',
			text: String(tasks.length),
		});
		const list = column.createDiv({ cls: 'thread-journal-task-board-list' });
		if (!tasks.length) {
			list.createDiv({
				cls: 'thread-journal-task-board-empty',
				text: t('No tasks in this state.'),
			});
			return;
		}
		for (const item of tasks) this.renderCard(list, item);
	}

	private renderCard(parent: HTMLElement, item: BoardTask): void {
		const { task } = item;
		const card = parent.createDiv({
			cls: `thread-journal-task-board-card${task.data.holding ? ' is-holding' : ''}`,
		});
		const meta = card.createDiv({ cls: 'thread-journal-task-board-card-meta' });
		for (const [index, thread] of item.threads.entries()) {
			if (index > 0) meta.createSpan({ cls: 'thread-journal-task-board-separator', text: '·' });
			const target = this.index.getEntry(thread.file) ?? thread.file;
			const link = meta.createEl('a', { text: thread.title, href: target.path });
			link.addEventListener('click', (event) => {
				event.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(target);
			});
		}
		if (task.pinned) {
			const pin = meta.createSpan({
				cls: 'thread-journal-task-board-pin',
				attr: { title: t('Pinned task'), 'aria-label': t('Pinned task') },
			});
			setIcon(pin, 'pin');
		}

		const body = card.createDiv({ cls: 'thread-journal-task-board-card-body' });
		const content = body.createEl('a', {
			cls: 'thread-journal-task-board-card-title',
			text: task.text,
			href: task.file.path,
		});
		content.addEventListener('click', (event) => {
			event.preventDefault();
			void this.openTaskSource(task);
		});
		const edit = body.createEl('button', {
			cls: 'clickable-icon thread-journal-task-board-edit',
			attr: { type: 'button', 'aria-label': t('Edit task'), title: t('Edit task') },
		});
		setIcon(edit, 'pencil');
		edit.addEventListener('click', () => {
			this.taskManager.openFileTaskEdit(
				task.file,
				task.line,
				task.sourceLine,
				task.data,
				() => void this.refresh(),
			);
		});

		const details = card.createDiv({ cls: 'thread-journal-task-board-card-details' });
		const addDetail = (text: string, icon: string, modifier = ''): void => {
			const detail = details.createSpan({
				cls: `thread-journal-task-board-detail${modifier ? ` is-${modifier}` : ''}`,
			});
			setIcon(detail.createSpan(), icon);
			detail.createSpan({ text });
		};
		const today = moment().format('YYYY-MM-DD');
		const holding = taskHoldingDisplay(task.data, today);
		if (holding) addDetail(holding, 'pause-circle', 'holding');
		const deadline = taskDeadlineDisplay(task.data, today);
		if (deadline) addDetail(deadline.label, 'calendar-clock', deadline.modifier);
		if (task.data.effort) {
			const effort = t(TASK_EFFORT_LABELS[task.data.effort]);
			addDetail(effort, 'gauge', `effort-${task.data.effort}`);
		}
		if (task.data.repeat) {
			const current = taskCurrentLabel(task.data.current, today, t('Today'));
			const repeat = taskRepeatRuleDisplay(task.data);
			addDetail(current || repeat, 'repeat-2', 'repeat');
			const last = details.lastElementChild;
			last?.setAttribute('title', repeat);
		}
		if (!details.hasChildNodes()) details.remove();
	}

	private async openTaskSource(task: AttentionRowTask): Promise<void> {
		await this.app.workspace.getLeaf(false).openFile(task.file, {
			eState: { line: task.line },
		});
	}
}

export async function openThreadTaskBoard(app: App): Promise<void> {
	try {
		let leaf = app.workspace.getLeavesOfType(THREAD_TASK_BOARD_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = app.workspace.getLeaf('tab');
			await leaf.setViewState({
				type: THREAD_TASK_BOARD_VIEW_TYPE,
				active: true,
			});
		}
		await app.workspace.revealLeaf(leaf);
		app.workspace.setActiveLeaf(leaf, { focus: true });
	} catch (error) {
		console.error('Thread Journal failed to open the thread task board', error);
		new Notice(t('Failed to open thread task board: {error}', { error: String(error) }));
	}
}
