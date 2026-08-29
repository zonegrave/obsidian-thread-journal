import type { TFile } from 'obsidian';

export type ThreadKind = 'normal' | 'area' | 'project';

export type DailyFieldControl =
	| 'text'
	| 'number'
	| 'toggle'
	| 'date'
	| 'datetime'
	| 'slider'
	| 'select'
	| 'textarea'
	| 'list';

export interface DailyFieldSpec {
	kind: 'field';
	key: string;
	label?: string;
	control: DailyFieldControl;
	unit?: string;
	min?: number;
	max?: number;
	step?: number;
	options?: string[];
}

export interface DailySectionSpec {
	kind: 'section';
	id: string;
	label: string;
	storage: 'body';
}

export type DailyFormItem = DailyFieldSpec | DailySectionSpec;

export interface DailyContribution {
	enabled: boolean;
	form: DailyFormItem[];
	fields: DailyFieldSpec[];
	sections: DailySectionSpec[];
}

export interface ThreadInfo {
	file: TFile;
	id: string;
	title: string;
	kind: ThreadKind;
	status: string;
	parentLink?: string;
	daily: DailyContribution;
}

export interface ThreadJournalSettings {
	threadsFolder: string;
	threadTemplatePath: string;
	dailyFolder: string;
	dailyFilePattern: string;
	dailyRecordsHeading: string;
	activeStatuses: string;
	autoComposeDaily: boolean;
}

export interface ThreadRecordsConfig {
	scope: 'self' | 'descendants';
	days: number;
	fields: string[];
	sections: string[];
	showEmpty: boolean;
}

export interface DailyRecord {
	file: TFile;
	date: string;
	values: Array<{ key: string; value: unknown }>;
	sections: Array<{
		threadTitle: string;
		heading: string;
		content: string;
	}>;
}
