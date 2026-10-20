import type { TranslationKey } from './i18n';
import type { ThreadTableCounts } from './thread-table-model';

export type ThreadTableColumn = keyof ThreadTableCounts | 'status';

export const THREAD_TABLE_COLUMNS: { key: ThreadTableColumn; label: TranslationKey }[] = [
	{ key: 'status', label: 'Status' },
	{ key: 'files', label: 'Thread files' },
	{ key: 'children', label: 'Child threads' },
	{ key: 'open', label: 'Open' },
	{ key: 'committed', label: 'Committed' },
	{ key: 'idea', label: 'Idea' },
	{ key: 'completed', label: 'Completed' },
	{ key: 'cancelled', label: 'Cancelled' },
	{ key: 'holding', label: 'Holding' },
	{ key: 'recurring', label: 'Recurring tasks' },
	{ key: 'pinned', label: 'Pinned tasks' },
	{ key: 'commits', label: 'Commits' },
	{ key: 'logs', label: 'Logs' },
];
