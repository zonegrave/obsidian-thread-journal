import {
	App,
	PluginSettingTab,
	normalizePath,
	type SettingDefinitionItem,
} from 'obsidian';
import { normalizeCommitFields } from './commit-model';
import { renderCommitFieldSettings } from './commit-settings';
import { t } from './i18n';
import type ThreadJournalPlugin from './main';
import type { ThreadJournalSettings } from './types';

export const DEFAULT_SETTINGS: ThreadJournalSettings = {
	language: 'auto',
	threadMetaFolder: '50-行动系统/Thread Meta',
	threadFilesFolder: '50-行动系统/Thread Files',
	threadRoleTemplatesFolder: 'Templates/Thread Roles',
	defaultThreadRoleTemplatePath: 'Templates/Thread Roles/Workspace.md',
	breadcrumbPosition: 'top',
	commitFields: normalizeCommitFields(undefined),
};

export function normalizedSettings(
	value: Partial<ThreadJournalSettings> | null | undefined,
): ThreadJournalSettings {
	const raw = value ?? {};
	const merged = { ...DEFAULT_SETTINGS, ...raw };
	return {
		language: ['auto', 'zh', 'en'].includes(merged.language)
			? merged.language
			: 'auto',
		threadMetaFolder: normalizePath(
			merged.threadMetaFolder.trim() || DEFAULT_SETTINGS.threadMetaFolder,
		),
		threadFilesFolder: normalizePath(
			merged.threadFilesFolder.trim() || DEFAULT_SETTINGS.threadFilesFolder,
		),
		threadRoleTemplatesFolder: normalizePath(
			merged.threadRoleTemplatesFolder.trim() || DEFAULT_SETTINGS.threadRoleTemplatesFolder,
		),
		defaultThreadRoleTemplatePath: normalizePath(
			merged.defaultThreadRoleTemplatePath.trim()
				|| DEFAULT_SETTINGS.defaultThreadRoleTemplatePath,
		),
		breadcrumbPosition: merged.breadcrumbPosition === 'bottom' ? 'bottom' : 'top',
		commitFields: normalizeCommitFields(raw.commitFields),
	};
}

export class ThreadJournalSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: ThreadJournalPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t('Language'),
				desc: t('Choose the language used by Thread Journal. Command names update after reloading the plugin.'),
				control: {
					type: 'dropdown',
					key: 'language',
					options: {
						auto: t('Follow Obsidian'),
						zh: t('Chinese'),
						en: t('English'),
					},
				},
			},
			{
				name: t('Thread meta folder'),
				desc: t('Each thread keeps its identity, status, parent relationship, and unique entry here.'),
				control: {
					type: 'text',
					key: 'threadMetaFolder',
					placeholder: DEFAULT_SETTINGS.threadMetaFolder,
				},
			},
			{
				name: t('Thread files folder'),
				desc: t('Thread member files created from role templates are saved here.'),
				control: {
					type: 'text',
					key: 'threadFilesFolder',
					placeholder: DEFAULT_SETTINGS.threadFilesFolder,
				},
			},
			{
				name: t('Thread role templates folder'),
				desc: t('Markdown templates in this folder become available when creating a thread file.'),
				control: {
					type: 'text',
					key: 'threadRoleTemplatesFolder',
					placeholder: DEFAULT_SETTINGS.threadRoleTemplatesFolder,
				},
			},
			{
				name: t('Default entry template'),
				desc: t('The initially selected role template when creating a thread. Its thread_role may define any role.'),
				control: {
					type: 'text',
					key: 'defaultThreadRoleTemplatePath',
					placeholder: DEFAULT_SETTINGS.defaultThreadRoleTemplatePath,
				},
			},
			{
				name: t('Breadcrumb position'),
				desc: t('Pin the breadcrumb above or below the thread document.'),
				control: {
					type: 'dropdown',
					key: 'breadcrumbPosition',
					options: {
						top: t('Above document'),
						bottom: t('Below document'),
					},
				},
			},
			{
				name: t('Default commit template'),
				desc: t('Threads without an independent template use these fields. Deprecated fields are hidden from new forms, retained for historical commits, and placed last.'),
				aliases: [t('Custom template fields')],
				render: (setting) => {
					setting.settingEl.empty();
					renderCommitFieldSettings(setting.settingEl, this.plugin, () => this.update());
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		if (!(key in this.plugin.settings)) return undefined;
		return this.plugin.settings[key as keyof ThreadJournalSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case 'language':
				this.plugin.settings.language = value === 'zh' || value === 'en'
					? value
					: 'auto';
				break;
			case 'threadMetaFolder':
			case 'threadFilesFolder':
			case 'threadRoleTemplatesFolder':
			case 'defaultThreadRoleTemplatePath':
				this.plugin.settings[key] = typeof value === 'string' ? value : '';
				break;
			case 'breadcrumbPosition':
				this.plugin.settings.breadcrumbPosition = value === 'bottom' ? 'bottom' : 'top';
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
		if (key === 'language') this.update();
	}
}
