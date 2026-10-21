import type { TranslationKey } from './i18n';
import type { ThreadTableCounts } from './thread-table-model';

export type ThreadTableColumn = keyof ThreadTableCounts | 'status';

export const THREAD_TABLE_COLUMNS: { key: ThreadTableColumn; label: TranslationKey; icon?: string }[] = [
	{ key: 'status', label: 'Status' },
	{ key: 'files', label: 'Thread files', icon: 'files' },
	{ key: 'children', label: 'Child threads', icon: 'git-branch' },
	{ key: 'open', label: 'Open', icon: 'circle' },
	{ key: 'committed', label: 'Committed', icon: 'circle-dot' },
	{ key: 'idea', label: 'Idea', icon: 'lightbulb' },
	{ key: 'completed', label: 'Completed', icon: 'circle-check' },
	{ key: 'cancelled', label: 'Cancelled', icon: 'circle-minus' },
	{ key: 'holding', label: 'Holding', icon: 'pause' },
	{ key: 'scheduled', label: 'Scheduled today', icon: 'calendar-check' },
	{ key: 'pinned', label: 'Pinned tasks', icon: 'pin' },
	{ key: 'commits', label: 'Commits', icon: 'git-commit-horizontal' },
	{ key: 'logs', label: 'Logs', icon: 'notebook-pen' },
];
