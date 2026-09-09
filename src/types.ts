import type { TFile } from 'obsidian';

export type CheckpointFieldControl =
	| 'text'
	| 'textarea'
	| 'number'
	| 'toggle'
	| 'date'
	| 'select';

export type CheckpointFieldStorage = 'inline' | 'body';

export interface CheckpointFieldSpec {
	key: string;
	label: string;
	control: CheckpointFieldControl;
	storage: CheckpointFieldStorage;
	required: boolean;
	deprecated: boolean;
	options: string[];
}

export interface ThreadInfo {
	file: TFile;
	id: string;
	title: string;
	status: string;
	parentLink?: string;
}

export interface ThreadJournalSettings {
	threadsFolder: string;
	workspacesFolder: string;
	workspaceSuffix: string;
	threadTemplatePath: string;
	breadcrumbPosition: 'top' | 'bottom';
	breadcrumbDefaultFilter: 'active' | 'all';
	checkpointFields: CheckpointFieldSpec[];
}
