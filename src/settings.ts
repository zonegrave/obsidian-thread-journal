import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import { normalizeCommitFields } from './commit-model';
import { renderCommitFieldSettings } from './commit-settings';
import { t, type LanguageSetting } from './i18n';
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t('Language'))
			.setDesc(t('Choose the language used by Thread Journal. Command names update after reloading the plugin.'))
			.addDropdown((dropdown) => dropdown
				.addOption('auto', t('Follow Obsidian'))
				.addOption('zh', t('Chinese'))
				.addOption('en', t('English'))
				.setValue(this.plugin.settings.language)
				.onChange(async (value) => {
					this.plugin.settings.language = ['zh', 'en'].includes(value)
						? value as LanguageSetting
						: 'auto';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('Thread meta folder'))
			.setDesc(t('Each thread keeps its identity, status, parent relationship, and unique entry here.'))
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadMetaFolder)
				.setValue(this.plugin.settings.threadMetaFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadMetaFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('Thread files folder'))
			.setDesc(t('Thread member files created from role templates are saved here.'))
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadFilesFolder)
				.setValue(this.plugin.settings.threadFilesFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadFilesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('Thread role templates folder'))
			.setDesc(t('Markdown templates in this folder become available when creating a thread file.'))
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadRoleTemplatesFolder)
				.setValue(this.plugin.settings.threadRoleTemplatesFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadRoleTemplatesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('Default entry template'))
			.setDesc(t('The initially selected role template when creating a thread. Its thread_role may define any role.'))
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.defaultThreadRoleTemplatePath)
				.setValue(this.plugin.settings.defaultThreadRoleTemplatePath)
				.onChange(async (value) => {
					this.plugin.settings.defaultThreadRoleTemplatePath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('Breadcrumb position'))
			.setDesc(t('Pin the breadcrumb above or below the thread document.'))
			.addDropdown((dropdown) => dropdown
				.addOption('top', t('Above document'))
				.addOption('bottom', t('Below document'))
				.setValue(this.plugin.settings.breadcrumbPosition)
				.onChange(async (value) => {
					this.plugin.settings.breadcrumbPosition = value === 'bottom' ? 'bottom' : 'top';
					await this.plugin.saveSettings();
					this.plugin.refreshBreadcrumbBars();
				}));

		renderCommitFieldSettings(containerEl, this.plugin, () => {
			this.display();
		});
	}
}
