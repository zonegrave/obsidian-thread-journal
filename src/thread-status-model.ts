import { t, type TranslationKey } from './i18n';

export type ThreadStatus = 'idea' | 'committed' | 'active' | 'dormant' | 'paused' | 'review' | 'completed' | 'closed';
export type OperationalThreadStatus = Extract<ThreadStatus, 'active' | 'dormant'>;

export interface ThreadStatusChoice {
 value: ThreadStatus;
 label: TranslationKey;
 description: TranslationKey;
}

export const THREAD_STATUS_CHOICES: readonly ThreadStatusChoice[] = [
 { value: 'idea', label: 'Idea', description: 'Keep the possibility without committing attention yet' },
 { value: 'committed', label: 'Committed', description: 'Committed to the work and waiting to begin; describe the commitment in the entry or a role file' },
 { value: 'active', label: 'Active', description: 'In progress and requiring continued attention; review the status when the subtree has no todo' },
 { value: 'dormant', label: 'Dormant', description: 'Open but handled on demand; ready todos require attention' },
 { value: 'paused', label: 'Paused', description: 'Explicitly frozen; keep unfinished items without cancelling the commitment' },
 { value: 'review', label: 'Review', description: 'Waiting for review, knowledge capture, or closure' },
 { value: 'completed', label: 'Completed', description: 'The goal is achieved and wrap-up is complete' },
 { value: 'closed', label: 'Closed', description: 'No longer continuing; retain the history' },
];

export function isThreadStatus(value: string): value is ThreadStatus {
 return THREAD_STATUS_CHOICES.some(choice => choice.value === value);
}

export function isOperationalThreadStatus(value: string): value is OperationalThreadStatus {
 return value === 'active' || value === 'dormant';
}

export function threadStatusUsesMembers(value: string): boolean {
	return value !== 'idea' && value !== 'committed';
}

export function threadStatusLabel(value: string): string {
	const choice = THREAD_STATUS_CHOICES.find(candidate => candidate.value === value);
	return choice ? t(choice.label) : value || t('No status');
}

export function threadStatusOptionLabel(choice: ThreadStatusChoice): string {
	return `${choice.value} — ${t(choice.label)}`;
}

export function threadStatusDescription(choice: ThreadStatusChoice): string {
	return t(choice.description);
}
