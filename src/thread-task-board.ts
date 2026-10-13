import {
	App,
	ItemView,
	Notice,
	moment,
	setIcon,
	type ViewStateResult,
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
import {
	renderThreadTaskItem,
	type ThreadTaskItemField,
} from './thread-task-item';
import type { ThreadInfo } from './types';
import { LANGUAGE_CHANGE_EVENT, t, type TranslationKey } from './i18n';

export const THREAD_TASK_BOARD_VIEW_TYPE = 'thread-journal-task-board';

const BOARD_STATUSES: TaskStatus[] = ['open', 'committed', 'idea'];
type BoardColumn = 'priority' | TaskStatus;
type BoardGroup = 'review' | 'current' | 'holding';

type TaskBoardField = 'thread' | ThreadTaskItemField;

const BOARD_FIELD_CHOICES: { field: TaskBoardField; label: TranslationKey }[] = [
	{ field: 'thread', label: 'Thread' },
	{ field: 'pin', label: 'Pin' },
	{ field: 'status', label: 'Status' },
	{ field: 'holding', label: 'Holding' },
	{ field: 'window', label: 'Window' },
	{ field: 'effort', label: 'Estimated effort' },
	{ field: 'repeat', label: 'Repeat' },
	{ field: 'actions', label: 'Actions' },
];

const BOARD_FIELDS = new Set<TaskBoardField>(BOARD_FIELD_CHOICES.map(({ field }) => field));

function boardFieldsFromState(state: unknown): Set<TaskBoardField> | undefined {
	if (typeof state !== 'object' || state === null) return undefined;
	const fields = (state as Record<string, unknown>).fields;
	if (!Array.isArray(fields)) return undefined;
	return new Set(fields.filter((field): field is TaskBoardField => (
		typeof field === 'string' && BOARD_FIELDS.has(field as TaskBoardField)
	)));
}

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
	private opened = false;
	private visibleFields = new Set<TaskBoardField>(BOARD_FIELDS);

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

	getState(): Record<string, unknown> {
		return {
			fields: BOARD_FIELD_CHOICES
				.map(({ field }) => field)
				.filter((field) => this.visibleFields.has(field)),
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		const fields = boardFieldsFromState(state);
		if (fields) this.visibleFields = fields;
		if (this.opened) this.render();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
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
		this.opened = false;
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
		const board = this.contentEl.createDiv({ cls: 'thread-journal-task-board' });
		const header = this.contentEl.createDiv({ cls: 'thread-journal-task-board-header' });
		header.createEl('h2', { text: t('Thread task board') });
		header.createSpan({
			cls: 'thread-journal-task-board-total',
			text: t('{count} tasks', { count: tasks.length }),
		});
		this.renderFieldMenu(header, () => this.renderBoard(board, tasks));
		const refresh = header.createEl('button', {
			cls: 'clickable-icon thread-journal-task-board-refresh',
			attr: { type: 'button', 'aria-label': t('Refresh'), title: t('Refresh') },
		});
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => {
			refresh.disabled = true;
			void this.refresh();
		});

		this.renderBoard(board, tasks);
	}

	private renderBoard(board: HTMLElement, tasks: BoardTask[]): void {
		board.empty();
		const pinned = tasks.filter((item) => item.task.pinned);
		const recurring = tasks.filter((item) => !item.task.pinned && item.task.data.repeat);
		this.renderPriorityColumn(board, pinned, recurring);
		for (const status of BOARD_STATUSES) {
			this.renderColumn(
				board,
				status,
				tasks.filter((item) => (
					!item.task.pinned
					&& !item.task.data.repeat
					&& item.task.data.status === status
				)),
			);
		}
	}

	private renderFieldMenu(parent: HTMLElement, onChange: () => void): void {
		const menu = parent.createEl('details', {
			cls: 'thread-journal-overview-filter-menu thread-journal-task-board-fields',
		});
		const summary = menu.createEl('summary', {
			cls: 'thread-journal-overview-filter-summary',
		});
		setIcon(summary.createSpan(), 'list-filter');
		summary.createSpan({ text: t('Fields') });
		const count = summary.createSpan({ cls: 'thread-journal-task-board-field-count' });
		const updateCount = (): void => count.setText(String(this.visibleFields.size));
		updateCount();
		const panel = menu.createDiv({
			cls: 'thread-journal-overview-filter-panel thread-journal-task-board-fields-panel',
		});
		for (const choice of BOARD_FIELD_CHOICES) {
			const option = panel.createEl('label', { cls: 'thread-journal-overview-filter-option' });
			const checkbox = option.createEl('input', { attr: { type: 'checkbox' } });
			checkbox.checked = this.visibleFields.has(choice.field);
			option.createSpan({ text: t(choice.label) });
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.visibleFields.add(choice.field);
				else this.visibleFields.delete(choice.field);
				updateCount();
				onChange();
				void this.app.workspace.requestSaveLayout();
			});
		}
	}

	private renderColumn(parent: HTMLElement, columnId: BoardColumn, tasks: BoardTask[]): void {
		const column = parent.createEl('section', {
			cls: `thread-journal-task-board-column is-${columnId}`,
		});
		const header = column.createDiv({ cls: 'thread-journal-task-board-column-header' });
		setIcon(
			header.createSpan({ cls: 'thread-journal-task-board-column-icon' }),
			columnId === 'priority' ? 'pin' : TASK_STATUS_ICONS[columnId],
		);
		header.createEl('h3', {
			text: columnId === 'priority' ? t('Pinned & recurring') : t(TASK_STATUS_LABELS[columnId]),
		});
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
		this.renderTaskGroups(list, tasks);
	}

	private renderPriorityColumn(
		parent: HTMLElement,
		pinned: BoardTask[],
		recurring: BoardTask[],
	): void {
		const column = parent.createEl('section', {
			cls: 'thread-journal-task-board-column is-priority',
		});
		const header = column.createDiv({ cls: 'thread-journal-task-board-column-header' });
		setIcon(header.createSpan({ cls: 'thread-journal-task-board-column-icon' }), 'pin');
		header.createEl('h3', { text: t('Pinned & recurring') });
		header.createSpan({
			cls: 'thread-journal-task-board-count',
			text: String(pinned.length + recurring.length),
		});
		const list = column.createDiv({ cls: 'thread-journal-task-board-list' });
		if (!pinned.length && !recurring.length) {
			list.createDiv({
				cls: 'thread-journal-task-board-empty',
				text: t('No tasks in this state.'),
			});
			return;
		}
		if (pinned.length) {
			list.createDiv({
				cls: 'thread-journal-task-board-section-title',
				text: `${t('Pinned tasks')} · ${pinned.length}`,
			});
			this.renderTaskGroups(list, pinned);
		}
		if (recurring.length) {
			list.createDiv({
				cls: 'thread-journal-task-board-section-title',
				text: `${t('Recurring tasks')} · ${recurring.length}`,
			});
			this.renderTaskGroups(list, recurring);
		}
	}

	private renderTaskGroups(parent: HTMLElement, tasks: BoardTask[]): void {
		const today = moment().format('YYYY-MM-DD');
		const grouped: Record<BoardGroup, BoardTask[]> = {
			review: [],
			current: [],
			holding: [],
		};
		for (const item of tasks) grouped[this.groupForTask(item, today)].push(item);
		this.renderGroup(parent, grouped.review, 'review');
		this.renderGroup(parent, grouped.current, 'current');
		this.renderGroup(parent, grouped.holding, 'holding');
	}

	private groupForTask(item: BoardTask, today: string): BoardGroup {
		const { data } = item.task;
		if (!data.holding) return 'current';
		if (data.holdingReview && data.holdingReview <= today) return 'review';
		return 'holding';
	}

	private renderGroup(parent: HTMLElement, tasks: BoardTask[], group: BoardGroup): void {
		if (!tasks.length) return;
		if (group !== 'current') {
			parent.createDiv({
				cls: `thread-journal-task-board-group-title is-${group}`,
				text: `${t(group === 'review' ? 'Review due' : 'Holding')} · ${tasks.length}`,
			});
		}
		for (const item of tasks) this.renderCard(parent, item, group);
	}

	private renderCard(parent: HTMLElement, item: BoardTask, group: BoardGroup): void {
		const { task } = item;
		const card = parent.createDiv({
			cls: [
				'thread-journal-task-board-card',
				group === 'review' ? 'is-review-due' : '',
				task.data.holding && this.visibleFields.has('holding') ? 'is-holding' : '',
			].filter(Boolean).join(' '),
		});
		if (this.visibleFields.has('thread')) {
			const meta = card.createDiv({ cls: 'thread-journal-task-board-card-meta' });
			const target = this.index.getEntry(item.thread.file) ?? item.thread.file;
			const link = meta.createEl('a', { text: item.thread.title, href: target.path });
			link.addEventListener('click', (event) => {
				event.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(target);
			});
		}
		const taskItem = card.createDiv({
			cls: 'thread-journal-overview-task thread-journal-task-board-task',
		});
		renderThreadTaskItem(taskItem, task, item.thread.file, {
			app: this.app,
			taskManager: this.taskManager,
			onRefresh: () => this.refresh(),
			isFieldVisible: (field) => this.visibleFields.has(field),
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
