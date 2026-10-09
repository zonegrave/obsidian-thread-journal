import {
	App,
	ItemView,
	Notice,
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
	TASK_STATUS_ICONS,
	TASK_STATUS_LABELS,
} from './task-display';
import type { TaskStatus } from './task-model';
import { renderThreadTaskItem } from './thread-task-item';
import type { ThreadInfo } from './types';
import { LANGUAGE_CHANGE_EVENT, t } from './i18n';

export const THREAD_TASK_BOARD_VIEW_TYPE = 'thread-journal-task-board';

const BOARD_STATUSES: TaskStatus[] = ['idea', 'committed', 'open'];

interface BoardTask {
	task: AttentionRowTask;
	thread: ThreadInfo;
}

function collectBoardTasks(rows: AttentionRow[]): BoardTask[] {
	const tasks: BoardTask[] = [];
	for (const row of rows) {
		for (const task of row.tasks) {
			if (!BOARD_STATUSES.includes(task.data.status)) continue;
			tasks.push({ task, thread: row.thread });
		}
	}
	return tasks.sort((left, right) => {
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
			|| left.task.text.localeCompare(right.task.text)
			|| left.thread.title.localeCompare(right.thread.title);
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
		const target = this.index.getEntry(item.thread.file) ?? item.thread.file;
		const link = meta.createEl('a', { text: item.thread.title, href: target.path });
		link.addEventListener('click', (event) => {
			event.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(target);
		});
		const taskItem = card.createDiv({
			cls: 'thread-journal-overview-task thread-journal-task-board-task',
		});
		renderThreadTaskItem(taskItem, task, item.thread.file, {
			app: this.app,
			taskManager: this.taskManager,
			onRefresh: () => this.refresh(),
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
