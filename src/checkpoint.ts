import {
	App,
	MarkdownView,
	Modal,
	Notice,
	Setting,
	TFile,
	moment,
} from 'obsidian';
import {
	buildCheckpointEntry,
	checkpointEditState,
	deleteCheckpointEntry,
	insertCheckpointEntry,
	replaceCheckpointEntry,
	type CheckpointValue,
	type ParsedCheckpointEntry,
} from './checkpoint-core';
import {
	activeCheckpointFields,
	checkpointFieldsForThread,
} from './checkpoint-model';
import {
	CHECKPOINT_PANEL_VIEW_TYPE,
	CheckpointPanelView,
	type CheckpointPanelRequest,
} from './checkpoint-panel';
import { CheckpointTemplateModal } from './checkpoint-template';
import { buildCheckpointModalForm, getModalFormApi } from './modal-form';
import type { ThreadIndex } from './thread-index';
import { THREAD_STATUS_CHOICES, type ThreadStatus } from './thread-status-model';
import type { CheckpointFieldSpec, ThreadJournalSettings } from './types';

function checkpointBlockId(): string {
	const suffix = Math.random().toString(36).slice(2, 7);
	return `cp-${moment().format('YYYYMMDD-HHmmss')}-${suffix}`;
}

function valueIsPresent(value: CheckpointValue | undefined): boolean {
	return value !== undefined && (typeof value !== 'string' || value.trim().length > 0);
}

function checkpointStatus(value: CheckpointValue | undefined): ThreadStatus | undefined {
	if (typeof value !== 'string') return undefined;
	return THREAD_STATUS_CHOICES.some((choice) => choice.value === value)
		? value as ThreadStatus
		: undefined;
}

function threadCheckpointFields(app: App, file: TFile): unknown {
	const frontmatter: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
	if (typeof frontmatter !== 'object' || frontmatter === null) return undefined;
	return (frontmatter as Record<string, unknown>).checkpoint_fields;
}

interface CheckpointModalInitialState {
	date: string;
	time: string;
	values: Record<string, CheckpointValue | undefined>;
}

type CheckpointSubmit = (
	date: string,
	time: string,
	values: Record<string, CheckpointValue | undefined>,
) => Promise<void>;

function checkpointFormValues(
	fields: CheckpointFieldSpec[],
	date: string,
	time: string,
	initial?: Record<string, CheckpointValue | undefined>,
): Record<string, CheckpointValue | undefined> {
	const values: Record<string, CheckpointValue | undefined> = {
		...initial,
		checkpoint_date: date,
		checkpoint_time: time,
	};
	for (const field of fields) {
		if (values[field.key] !== undefined) continue;
		if (field.control === 'toggle') values[field.key] = false;
		else if (field.control === 'select' && field.required && field.options[0]) {
			values[field.key] = field.options[0];
		}
		else if (field.control === 'date' && field.required) values[field.key] = date;
	}
	return values;
}

function checkpointValue(value: unknown): CheckpointValue | undefined {
	if (typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return undefined;
}

class CheckpointModal extends Modal {
	private date: string;
	private time: string;
	private readonly values: Record<string, CheckpointValue | undefined>;
	private saving = false;

	constructor(
		app: App,
		private readonly threadFile: TFile,
		private readonly fields: CheckpointFieldSpec[],
		private readonly onSubmit: CheckpointSubmit,
		private readonly initial?: CheckpointModalInitialState,
	) {
		super(app);
		this.date = initial?.date || moment().format('YYYY-MM-DD');
		this.time = initial?.time || moment().format('HH:mm');
		this.values = checkpointFormValues(fields, this.date, this.time, initial?.values);
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-checkpoint-modal');
		this.setTitle(this.initial ? '编辑 checkpoint' : '创建 checkpoint');
		this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-target',
			text: this.threadFile.basename,
		});

		const systemFields = this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-system-fields',
		});
		new Setting(systemFields)
			.setClass('thread-journal-checkpoint-form-field')
			.setClass('is-compact')
			.setName('日期')
			.setDesc('Checkpoint 的发生日期。')
			.addText((text) => {
				text.inputEl.type = 'date';
				text.setValue(this.date).onChange((value) => {
					this.date = value;
				});
			});

		new Setting(systemFields)
			.setClass('thread-journal-checkpoint-form-field')
			.setClass('is-compact')
			.setName('时间')
			.setDesc('Checkpoint 的发生时间。')
			.addText((text) => {
				text.inputEl.type = 'time';
				text.setValue(this.time).onChange((value) => {
					this.time = value;
				});
			});

		let focusTarget: HTMLInputElement | HTMLTextAreaElement | undefined;
		const customFields = this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-custom-fields',
		});
		for (const field of this.fields) {
			const wide = field.control === 'text' || field.control === 'textarea';
			const setting = new Setting(customFields)
				.setClass('thread-journal-checkpoint-form-field')
				.setClass(wide ? 'is-wide' : 'is-compact')
				.setClass(`is-${field.control}`)
				.setName(`${field.label}${field.required ? ' *' : ''}`)
				.setDesc(field.storage === 'inline'
					? `可查询字段 · ${field.key}`
					: `Checkpoint 正文 · ${field.key}`);
				switch (field.control) {
				case 'textarea':
					setting.addTextArea((text) => {
						const current = this.values[field.key];
						text.setValue(typeof current === 'string' ? current : '')
							.setPlaceholder(field.label).onChange((value) => {
							this.values[field.key] = value;
						});
						text.inputEl.rows = 6;
						focusTarget ??= field.required ? text.inputEl : undefined;
					});
					break;
				case 'toggle':
					setting.addToggle((toggle) => toggle
						.setValue(Boolean(this.values[field.key]))
						.onChange((value) => {
							this.values[field.key] = value;
						}));
					break;
				case 'select':
					setting.addDropdown((dropdown) => {
						if (!field.required) dropdown.addOption('', '未选择');
						for (const option of field.options) dropdown.addOption(option, option);
						const current = this.values[field.key];
						if (
							typeof current === 'string'
							&& current
							&& !field.options.includes(current)
						) {
							dropdown.addOption(current, current);
						}
						dropdown.setValue(typeof current === 'string' ? current : '');
						dropdown.onChange((value) => {
							this.values[field.key] = value;
						});
					});
					break;
				default:
					setting.addText((text) => {
						if (field.control === 'date') text.inputEl.type = 'date';
						if (field.control === 'number') text.inputEl.type = 'number';
						const current = this.values[field.key];
						text.setValue(typeof current === 'string' ? current : '')
							.setPlaceholder(field.label)
							.onChange((value) => {
								this.values[field.key] = value;
							});
						focusTarget ??= field.required ? text.inputEl : undefined;
					});
			}
		}

		const actions = new Setting(this.contentEl)
			.setClass('thread-journal-checkpoint-actions');
		actions.addButton((button) => button
			.setButtonText(this.initial ? '保存修改' : '保存 checkpoint')
			.setCta()
			.onClick(async () => {
				if (this.saving) return;
				if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) {
					new Notice('请填写有效的 checkpoint 日期。');
					return;
				}
				if (!/^\d{2}:\d{2}$/.test(this.time)) {
					new Notice('请填写有效的 checkpoint 时间。');
					return;
				}
				const missing = this.fields.find((field) =>
					field.required && !valueIsPresent(this.values[field.key]));
				if (missing) {
					new Notice(`请填写${missing.label}。`);
					return;
				}
				this.saving = true;
				button.setDisabled(true);
				try {
					await this.onSubmit(this.date, this.time, { ...this.values });
					this.close();
				} catch (error) {
					console.error('Thread Journal failed to save checkpoint', error);
					new Notice(`保存 Checkpoint 失败：${String(error)}`);
					this.saving = false;
					button.setDisabled(false);
				}
			}));

		window.setTimeout(() => focusTarget?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class CheckpointDeleteModal extends Modal {
	private deleting = false;

	constructor(
		app: App,
		private readonly threadFile: TFile,
		private readonly entry: ParsedCheckpointEntry,
		private readonly onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('删除 checkpoint');
		const date = this.entry.values.checkpoint_date || '未填写日期';
		const time = this.entry.values.checkpoint_time;
		this.contentEl.createEl('p', {
			text: `确定删除 ${date}${time ? ` ${time}` : ''} 的 checkpoint 吗？`,
		});
		this.contentEl.createEl('p', {
			cls: 'mod-warning',
			text: `只会删除 ${this.threadFile.basename} 中这条 checkpoint 的记录块。`,
		});
		const actions = new Setting(this.contentEl)
			.setClass('thread-journal-checkpoint-actions');
		actions.addButton((button) => button
			.setButtonText('取消')
			.onClick(() => this.close()));
		actions.addButton((button) => button
			.setButtonText('删除 checkpoint')
			.setWarning()
			.onClick(async () => {
				if (this.deleting) return;
				this.deleting = true;
				button.setDisabled(true);
				try {
					await this.onConfirm();
					this.close();
				} catch (error) {
					console.error('Thread Journal failed to delete checkpoint', error);
					new Notice(`删除 checkpoint 失败：${String(error)}`);
					this.deleting = false;
					button.setDisabled(false);
				}
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class CheckpointManager {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	getCurrentThreadFile(): TFile | undefined {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) return undefined;
		return this.index.getThreadFile(file);
	}

	private openCheckpointForm(
		threadFile: TFile,
		fields: CheckpointFieldSpec[],
		onSubmit: CheckpointSubmit,
		initial?: CheckpointModalInitialState,
	): void {
		const date = initial?.date || moment().format('YYYY-MM-DD');
		const time = initial?.time || moment().format('HH:mm');
		const values = checkpointFormValues(fields, date, time, initial?.values);
		const request: CheckpointPanelRequest = {
			mode: initial ? 'edit' : 'create',
			threadFile,
			fields,
			date,
			time,
			values,
			onSubmit,
		};
		void this.openCheckpointPanel(request).catch((error: unknown) => {
			console.error('Thread Journal failed to open checkpoint side panel', error);
			new Notice('Checkpoint 侧栏打开失败，已使用原表单。');
			this.openFallbackCheckpointForm(threadFile, fields, onSubmit, initial);
		});
	}

	private async openCheckpointPanel(request: CheckpointPanelRequest): Promise<void> {
		const leaf = await this.app.workspace.ensureSideLeaf(
			CHECKPOINT_PANEL_VIEW_TYPE,
			'right',
			{ active: true, reveal: true },
		);
		await leaf.loadIfDeferred();
		if (!(leaf.view instanceof CheckpointPanelView)) {
			throw new Error('Checkpoint 侧栏视图未正确加载。');
		}
		leaf.view.setForm(request);
		await this.app.workspace.revealLeaf(leaf);
	}

	private openFallbackCheckpointForm(
		threadFile: TFile,
		fields: CheckpointFieldSpec[],
		onSubmit: CheckpointSubmit,
		initial?: CheckpointModalInitialState,
	): void {
		const api = getModalFormApi(this.app);
		if (!api) {
			new CheckpointModal(this.app, threadFile, fields, onSubmit, initial).open();
			return;
		}
		const date = initial?.date || moment().format('YYYY-MM-DD');
		const time = initial?.time || moment().format('HH:mm');
		const values = checkpointFormValues(fields, date, time, initial?.values);
		const definition = buildCheckpointModalForm(
			`${initial ? '编辑' : '创建'} checkpoint · ${threadFile.basename}`,
			fields,
			values,
		);
		void api.openForm(definition, { values }).then(async (result) => {
			if (result.status !== 'ok') return;
			const data = result.getData();
			const nextDate = checkpointValue(data.checkpoint_date);
			const nextTime = checkpointValue(data.checkpoint_time);
			if (typeof nextDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
				new Notice('Modal form 未返回有效的 checkpoint 日期。');
				return;
			}
			if (typeof nextTime !== 'string' || !/^\d{2}:\d{2}$/.test(nextTime)) {
				new Notice('Modal form 未返回有效的 checkpoint 时间。');
				return;
			}
			const nextValues: Record<string, CheckpointValue | undefined> = {};
			for (const field of fields) nextValues[field.key] = checkpointValue(data[field.key]);
			try {
				await onSubmit(nextDate, nextTime, nextValues);
			} catch (error) {
				console.error('Thread Journal failed to save Modal Form checkpoint', error);
				new Notice(`保存 Checkpoint 失败：${String(error)}`);
			}
		}).catch((error: unknown) => {
			console.error('Thread Journal failed to open Modal Form', error);
			new Notice('Modal form 打开失败，已使用内置表单。');
			new CheckpointModal(this.app, threadFile, fields, onSubmit, initial).open();
		});
	}

	openCurrentCheckpointTemplateModal(): void {
		const threadFile = this.getCurrentThreadFile();
		if (!threadFile) {
			new Notice('当前文件不属于 thread。');
			return;
		}
		const ownTemplate = threadCheckpointFields(this.app, threadFile);
		const fields = checkpointFieldsForThread(
			ownTemplate,
			this.getSettings().checkpointFields,
		);
		new CheckpointTemplateModal(
			this.app,
			threadFile,
			fields,
			!Array.isArray(ownTemplate),
			async (nextFields) => {
				await this.app.fileManager.processFrontMatter(threadFile, (metadata) => {
					(metadata as Record<string, unknown>).checkpoint_fields = nextFields;
				});
			},
			async () => {
				await this.app.fileManager.processFrontMatter(threadFile, (metadata) => {
					delete (metadata as Record<string, unknown>).checkpoint_fields;
				});
				new Notice(`${threadFile.basename} 已改为使用全局默认模板。`);
			},
		).open();
	}

	openCurrentCheckpointModal(): void {
		const threadFile = this.getCurrentThreadFile();
		if (!threadFile) {
			new Notice('当前文件不属于 thread。');
			return;
		}
		const ownTemplate = threadCheckpointFields(this.app, threadFile);
		const fields = activeCheckpointFields(checkpointFieldsForThread(
			ownTemplate,
			this.getSettings().checkpointFields,
		));
		this.openCheckpointForm(threadFile, fields, async (date, time, values) => {
			const entry = buildCheckpointEntry({
				date,
				time,
				blockId: checkpointBlockId(),
				fields,
				values,
			});
			await this.app.vault.process(threadFile, (content) =>
				insertCheckpointEntry(content, entry));
			const nextStatus = checkpointStatus(values.status_after);
			if (nextStatus) {
				try {
					await this.app.fileManager.processFrontMatter(threadFile, (frontmatter) => {
						const metadata = frontmatter as Record<string, unknown>;
						metadata.status = nextStatus;
					});
				} catch (error) {
					console.error('Thread Journal failed to update status after checkpoint', error);
					new Notice(`Checkpoint 已保存，但状态更新失败：${String(error)}`);
					return;
				}
			}
			new Notice(`已为 ${threadFile.basename} 创建 checkpoint。`);
		});
	}

	openCheckpointEditModal(threadFile: TFile, entry: ParsedCheckpointEntry): void {
		if (!entry.blockId) {
			new Notice('这条 checkpoint 没有块 ID，无法安全编辑。');
			return;
		}
		const ownTemplate = threadCheckpointFields(this.app, threadFile);
		const templateFields = checkpointFieldsForThread(
			ownTemplate,
			this.getSettings().checkpointFields,
		);
		const editState = checkpointEditState(templateFields, entry);
		this.openCheckpointForm(
			threadFile,
			editState.fields,
			async (date, time, values) => {
				const replacement = buildCheckpointEntry({
					date,
					time,
					blockId: entry.blockId ?? '',
					fields: editState.fields,
					values,
				});
				await this.app.vault.process(threadFile, (content) =>
					replaceCheckpointEntry(content, entry.blockId ?? '', replacement));
				new Notice(`已更新 ${threadFile.basename} 的 checkpoint。`);
			},
			{
				date: entry.values.checkpoint_date || moment().format('YYYY-MM-DD'),
				time: entry.values.checkpoint_time || moment().format('HH:mm'),
				values: editState.values,
			},
		);
	}

	openCheckpointDeleteModal(threadFile: TFile, entry: ParsedCheckpointEntry): void {
		if (!entry.blockId) {
			new Notice('这条 checkpoint 没有块 ID，无法安全删除。');
			return;
		}
		new CheckpointDeleteModal(this.app, threadFile, entry, async () => {
			await this.app.vault.process(threadFile, (content) =>
				deleteCheckpointEntry(content, entry.blockId ?? ''));
			new Notice(`已删除 ${threadFile.basename} 的 checkpoint。`);
		}).open();
	}
}
