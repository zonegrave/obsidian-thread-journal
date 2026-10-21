import { renderTaskSchedule } from './task-schedule-display';
import {
	Notice,
	moment,
	setIcon,
	type App,
	type TFile,
} from 'obsidian';
import {
	moveAttentionTaskToNext,
	setAttentionTaskPinned,
	type AttentionRowTask,
} from './thread-attention';
import {
	TASK_EFFORT_LABELS,
	TASK_STATUS_ICONS,
	TASK_STATUS_LABELS,
	taskDeadlineDisplay,
	taskHoldingDisplay,
} from './task-display';
import type { TaskManager } from './task';
import { t } from './i18n';

export interface ThreadTaskItemContext {
	app: App;
	taskManager: TaskManager;
	onRefresh: () => void | Promise<void>;
	isFieldVisible?: (field: ThreadTaskItemField) => boolean;
}

export type ThreadTaskItemField =
	| 'pin'
	| 'status'
	| 'holding'
	| 'window'
	| 'effort'
	| 'schedule'
	| 'actions';

export function renderThreadTaskItem(
	parent: HTMLElement,
	task: AttentionRowTask,
	threadFile: TFile,
	context: ThreadTaskItemContext,
): void {
	const visible = (field: ThreadTaskItemField): boolean => context.isFieldVisible?.(field) ?? true;
	parent.toggleClass('is-pin-hidden', !visible('pin'));
	parent.toggleClass('is-actions-hidden', !visible('actions'));
	if (visible('pin')) renderTaskPinButton(parent, task, context);
	renderTaskLink(parent, task, context.app, visible('status'));
	renderTaskDetails(parent, task, context, visible);
	if (visible('actions')) renderTaskActions(parent, task, threadFile, context);
}

function renderTaskLink(
	parent: HTMLElement,
	task: AttentionRowTask,
	app: App,
	showStatus: boolean,
): void {
	const taskLink = parent.createEl('a', {
		cls: 'thread-journal-overview-task-link',
		href: task.file.path,
	});
	if (showStatus) {
		const statusLabel = t(TASK_STATUS_LABELS[task.data.status]);
		const status = taskLink.createSpan({
			cls: `thread-journal-overview-task-status is-${task.data.status}`,
			attr: {
				'aria-label': statusLabel,
				title: statusLabel,
			},
		});
		setIcon(status, TASK_STATUS_ICONS[task.data.status]);
	}
	taskLink.createSpan({
		cls: 'thread-journal-overview-task-text',
		text: task.text,
	});
	taskLink.addEventListener('click', (event) => {
		event.preventDefault();
		void app.workspace.getLeaf(false).openFile(task.file, {
			eState: { line: task.line },
		});
	});
}

function renderTaskDetails(
	parent: HTMLElement,
	task: AttentionRowTask,
	context: ThreadTaskItemContext,
	visible: (field: ThreadTaskItemField) => boolean,
): void {
	const { data } = task;
	const details = parent.createDiv({ cls: 'thread-journal-overview-task-details' });
	const addDetail = (text: string, icon: string, modifier = ''): void => {
		const detail = details.createSpan({
			cls: `thread-journal-overview-task-detail${modifier ? ` is-${modifier}` : ''}`,
		});
		setIcon(detail.createSpan({ cls: 'thread-journal-task-chip-icon' }), icon);
		detail.createSpan({ text });
	};
	if (visible('status') && task.disposition === 'unknown') {
		addDetail(t('other'), 'circle-alert', 'disposition-unknown');
	}
	const today = moment().format('YYYY-MM-DD');
	const holding = taskHoldingDisplay(data, today);
	if (visible('holding') && holding) addDetail(holding, 'pause-circle');
	const deadline = taskDeadlineDisplay(data, today);
	if (visible('window') && deadline) {
		addDetail(deadline.label, 'calendar-clock', deadline.modifier);
	}
	if (visible('effort') && data.effort) {
		const label = t(TASK_EFFORT_LABELS[data.effort]);
		const effort = details.createSpan({
			cls: `thread-journal-task-effort is-${data.effort}`,
			attr: { title: label, 'aria-label': label },
		});
		setIcon(effort, 'gauge');
	}
	if (visible('schedule')) renderTaskSchedule(details, data, today, async () => {
		await moveAttentionTaskToNext(context.app, task);
		await context.onRefresh();
	});
	if (!details.hasChildNodes()) details.remove();
}

function renderTaskActions(
	parent: HTMLElement,
	task: AttentionRowTask,
	threadFile: TFile,
	context: ThreadTaskItemContext,
): void {
	const actions = parent.createDiv({ cls: 'thread-journal-overview-task-actions' });
	const commit = actions.createEl('button', {
		cls: 'clickable-icon thread-journal-task-commit',
		attr: {
			type: 'button',
			'aria-label': t('Create commit from task'),
			title: t('Create commit from task'),
		},
	});
	setIcon(commit, 'git-commit-horizontal');
	commit.addEventListener('click', () => {
		context.taskManager.openFileTaskCommit(
			task.file,
			task.line,
			task.sourceLine,
			task.data,
			threadFile,
			() => void context.onRefresh(),
		);
	});
	const edit = actions.createEl('button', {
		cls: 'clickable-icon thread-journal-overview-task-edit',
		attr: { type: 'button', 'aria-label': t('Edit task'), title: t('Edit task') },
	});
	setIcon(edit, 'pencil');
	edit.addEventListener('click', () => {
		context.taskManager.openFileTaskEdit(
			task.file,
			task.line,
			task.sourceLine,
			task.data,
			() => void context.onRefresh(),
		);
	});
}

function renderTaskPinButton(
	parent: HTMLElement,
	task: AttentionRowTask,
	context: ThreadTaskItemContext,
): void {
	const button = parent.createEl('button', {
		cls: `clickable-icon thread-journal-overview-task-pin${task.pinned ? ' is-pinned' : ''}`,
		attr: {
			type: 'button',
			'aria-label': task.pinned ? t('Unpin task') : t('Pin task'),
			'aria-pressed': String(task.pinned),
		},
	});
	button.disabled = Boolean(task.data.scheduled);
	if (task.data.scheduled) button.setAttribute('title', t('Scheduled tasks cannot be pinned.'));
	setIcon(button, task.pinned ? 'pin-off' : 'pin');
	button.addEventListener('click', () => {
		button.disabled = true;
		void setAttentionTaskPinned(context.app, task, !task.pinned)
			.then(() => context.onRefresh())
			.catch((error: unknown) => {
				button.disabled = false;
				console.error('Thread Journal failed to update pinned task', error);
				new Notice(t('Failed to update pinned task: {error}', { error: String(error) }));
			});
	});
}
