import type { TFile } from 'obsidian';
import type { LanguageSetting } from './i18n';

export type CommitFieldControl =
	| 'text'
	| 'textarea'
	| 'number'
	| 'toggle'
	| 'date'
	| 'select';

export type CommitFieldStorage = 'inline' | 'body';

export interface CommitFieldSpec {
	key: string;
	label: string;
	control: CommitFieldControl;
	storage: CommitFieldStorage;
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
	attentionFallback: boolean;
}

export interface ThreadJournalSettings {
	language: LanguageSetting;
	threadMetaFolder: string;
	threadFilesFolder: string;
	threadRoleTemplatesFolder: string;
	defaultThreadRoleTemplatePath: string;
	breadcrumbPosition: 'top' | 'bottom';
	commitFields: CommitFieldSpec[];
}
