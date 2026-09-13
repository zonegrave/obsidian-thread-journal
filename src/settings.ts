import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import { normalizeCheckpointFields } from './checkpoint-model';
import { renderCheckpointFieldSettings } from './checkpoint-settings';
import type ThreadJournalPlugin from './main';
import type { ThreadJournalSettings } from './types';

export const DEFAULT_SETTINGS: ThreadJournalSettings = {
	threadMetaFolder: '50-行动系统/Thread Meta',
	threadFilesFolder: '50-行动系统/Thread Files',
	threadRoleTemplatesFolder: 'Templates/Thread Roles',
	defaultThreadRoleTemplatePath: 'Templates/Thread Roles/Workspace.md',
	breadcrumbPosition: 'top',
	breadcrumbDefaultFilter: 'operational',
	checkpointFields: normalizeCheckpointFields(undefined),
};

export function normalizedSettings(
	value: Partial<ThreadJournalSettings> | null | undefined,
): ThreadJournalSettings {
	const raw = value ?? {};
	const merged = { ...DEFAULT_SETTINGS, ...raw };
	return {
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
		breadcrumbDefaultFilter: merged.breadcrumbDefaultFilter === 'all' ? 'all' : 'operational',
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
			.setName('Thread meta 目录')
			.setDesc('每个 thread 的身份、状态、父子关系与唯一入口保存在这里。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadMetaFolder)
				.setValue(this.plugin.settings.threadMetaFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadMetaFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Thread 文件目录')
			.setDesc('通过角色模板新建的 thread 成员文件保存在这里。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadFilesFolder)
				.setValue(this.plugin.settings.threadFilesFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadFilesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Thread 角色模板目录')
			.setDesc('目录中的 Markdown 模板会成为“新建 thread 文件”的可选角色。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadRoleTemplatesFolder)
				.setValue(this.plugin.settings.threadRoleTemplatesFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadRoleTemplatesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('默认入口模板')
			.setDesc('新建 thread 时默认选中的角色模板；模板可通过 thread_role 定义任意角色。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.defaultThreadRoleTemplatePath)
				.setValue(this.plugin.settings.defaultThreadRoleTemplatePath)
				.onChange(async (value) => {
					this.plugin.settings.defaultThreadRoleTemplatePath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Breadcrumb 位置')
			.setDesc('固定在 thread 正文区域的上方或下方。')
			.addDropdown((dropdown) => dropdown
				.addOption('top', '正文上方')
				.addOption('bottom', '正文下方')
				.setValue(this.plugin.settings.breadcrumbPosition)
				.onChange(async (value) => {
					this.plugin.settings.breadcrumbPosition = value === 'bottom' ? 'bottom' : 'top';
					await this.plugin.saveSettings();
					this.plugin.refreshBreadcrumbBars();
				}));

		new Setting(containerEl)
			.setName('Breadcrumb 层级默认范围')
			.setDesc('根节点和分隔箭头默认显示“投入中”（active 与 dormant），或显示全部状态。工具条最右侧可以临时切换。')
			.addDropdown((dropdown) => dropdown
				.addOption('operational', '投入中（active + dormant）')
				.addOption('all', '全部 thread')
				.setValue(this.plugin.settings.breadcrumbDefaultFilter)
				.onChange(async (value) => {
					this.plugin.settings.breadcrumbDefaultFilter = value === 'all' ? 'all' : 'operational';
					await this.plugin.saveSettings();
					this.plugin.refreshBreadcrumbBars(true);
				}));

		renderCheckpointFieldSettings(containerEl, this.plugin, () => {
			this.display();
		});
	}
}
