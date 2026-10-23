import type { TranslationKey } from './i18n';
import type { TaskStatus } from './task-model';

export type ThreadTableColumn = 'status' | 'files' | 'children' | 'tasks' | 'commits' | 'logs';

export const THREAD_TABLE_COLUMNS: { key: ThreadTableColumn; label: TranslationKey; icon?: string }[] = [
	{ key: 'status', label: 'Status' },
	{ key: 'files', label: 'Thread files', icon: 'files' },
	{ key: 'children', label: 'Child threads', icon: 'git-branch' },
	{ key: 'tasks', label: 'Tasks', icon: 'list-todo' },
	{ key: 'commits', label: 'Commits', icon: 'git-commit-horizontal' },
	{ key: 'logs', label: 'Logs', icon: 'notebook-pen' },
];

export const TABLE_TASK_BUTTONS: { key: TaskStatus; label: TranslationKey; icon: string }[] = [
	{ key: 'open', label: 'Open', icon: 'circle' },
	{ key: 'committed', label: 'Committed', icon: 'circle-dot' },
	{ key: 'idea', label: 'Idea', icon: 'lightbulb' },
	{ key: 'cancelled', label: 'Cancelled', icon: 'circle-minus' },
	{ key: 'completed', label: 'Completed', icon: 'circle-check' },
];
