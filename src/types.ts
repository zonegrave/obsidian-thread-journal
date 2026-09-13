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

export type ThreadRoleStatus = 'active' | 'terminated';

export interface ThreadMemberInfo {
	file: TFile;
	threadId: string;
	role: string;
	roleStatus: ThreadRoleStatus;
}

export interface ThreadJournalSettings {
	threadMetaFolder: string;
	threadFilesFolder: string;
	threadRoleTemplatesFolder: string;
	defaultThreadRoleTemplatePath: string;
	breadcrumbPosition: 'top' | 'bottom';
	breadcrumbDefaultFilter: 'operational' | 'all';
	checkpointFields: CheckpointFieldSpec[];
}
