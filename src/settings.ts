import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import { normalizeCheckpointFields } from './checkpoint-model';
import { renderCheckpointFieldSettings } from './checkpoint-settings';
import { normalizeWorkspaceSuffix } from './core';
import type ThreadJournalPlugin from './main';
import type { ThreadJournalSettings } from './types';

export const DEFAULT_SETTINGS: ThreadJournalSettings = {
	threadsFolder: '50-行动系统',
	workspacesFolder: '50-行动系统/工作区',
	workspaceSuffix: '工作区',
	threadTemplatePath: 'Templates/Thread.md',
	checkpointFields: normalizeCheckpointFields(undefined),
};

export function normalizedSettings(
	value: Partial<ThreadJournalSettings> | null | undefined,
): ThreadJournalSettings {
	const raw = value ?? {};
	const merged = { ...DEFAULT_SETTINGS, ...raw };
	return {
		threadsFolder: normalizePath(merged.threadsFolder.trim() || DEFAULT_SETTINGS.threadsFolder),
		workspacesFolder: normalizePath(
			merged.workspacesFolder.trim() || DEFAULT_SETTINGS.workspacesFolder,
		),
		workspaceSuffix: normalizeWorkspaceSuffix(
			merged.workspaceSuffix,
			DEFAULT_SETTINGS.workspaceSuffix,
		),
		threadTemplatePath: normalizePath(
			merged.threadTemplatePath.trim() || DEFAULT_SETTINGS.threadTemplatePath,
		),
		checkpointFields: normalizeCheckpointFields(raw.checkpointFields),
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
			.setName('线程目录')
			.setDesc('新建 thread 文件的位置。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadsFolder)
				.setValue(this.plugin.settings.threadsFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Thread 工作区目录')
			.setDesc('新建的 thread 工作区统一保存在此目录；已有文件不会自动移动。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.workspacesFolder)
				.setValue(this.plugin.settings.workspacesFolder)
				.onChange(async (value) => {
					this.plugin.settings.workspacesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('工作区文件后缀')
			.setDesc('新建工作区文件使用“thread 文件名·后缀”；已有文件不会自动改名。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.workspaceSuffix)
				.setValue(this.plugin.settings.workspaceSuffix)
				.onChange(async (value) => {
					this.plugin.settings.workspaceSuffix = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Thread 模板')
			.setDesc('新建 thread 时读取的完整 Markdown 模板；身份和层级属性仍由插件校正。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadTemplatePath)
				.setValue(this.plugin.settings.threadTemplatePath)
				.onChange(async (value) => {
					this.plugin.settings.threadTemplatePath = value;
					await this.plugin.saveSettings();
				}));

		renderCheckpointFieldSettings(containerEl, this.plugin, () => {
			this.display();
		});
	}
}
