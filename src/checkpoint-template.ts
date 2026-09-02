import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import {
	cloneCheckpointFields,
	normalizeCheckpointFields,
	placeDeprecatedFieldsLast,
} from './checkpoint-model';
import {
	buildCheckpointTemplateFieldModalForm,
	checkpointFieldFromModalData,
	checkpointTemplateFieldValues,
	getModalFormApi,
	type ModalFormApi,
} from './modal-form';
import type { CheckpointFieldSpec } from './types';

export class CheckpointTemplateModal extends Modal {
	private fields: CheckpointFieldSpec[];
	private saving = false;
	private readonly modalFormApi: ModalFormApi | undefined;

	constructor(
		app: App,
		private readonly threadFile: TFile,
		initialFields: CheckpointFieldSpec[],
		private readonly inherited: boolean,
		private readonly onSave: (fields: CheckpointFieldSpec[]) => Promise<void>,
		private readonly onUseDefault: () => Promise<void>,
	) {
		super(app);
		this.fields = cloneCheckpointFields(initialFields);
		this.modalFormApi = getModalFormApi(app);
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-checkpoint-template-modal');
		this.setTitle('编辑 checkpoint 模板');
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-target',
			text: this.threadFile.basename,
		});
		this.contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: this.inherited
				? '当前继承全局默认模板。保存后会为此 thread 建立独立模板。废弃字段不再用于新 checkpoint，但仍解释历史数据。'
				: '当前使用此 thread 的独立模板。废弃字段不再用于新 checkpoint，但仍解释历史数据。',
		});

		this.fields.forEach((field, index) => {
			if (this.modalFormApi) this.renderFieldSummary(field, index);
			else this.renderField(field, index);
		});

		new Setting(this.contentEl)
			.setName('模板字段')
			.setDesc('字段可以全部删除；此时 checkpoint 只保留固定的日期、时间和标记。')
			.addButton((button) => button
				.setButtonText('添加字段')
				.onClick(() => {
					const next = this.fields.length + 1;
					const field: CheckpointFieldSpec = {
						key: `checkpoint_field_${next}`,
						label: `自定义字段 ${next}`,
						control: 'text',
						storage: 'inline',
						required: false,
						deprecated: false,
						options: [],
					};
					if (this.modalFormApi) void this.openFieldForm(field, undefined);
					else {
						this.fields.push(field);
						this.render();
					}
				}));

		const actions = new Setting(this.contentEl)
			.setClass('thread-journal-checkpoint-actions');
		actions.addButton((button) => button
			.setButtonText('使用全局默认模板')
			.onClick(async () => {
				if (this.saving) return;
				this.saving = true;
				button.setDisabled(true);
				try {
					await this.onUseDefault();
					this.close();
				} catch (error) {
					console.error('Thread Journal failed to reset checkpoint template', error);
					new Notice(`恢复默认模板失败：${String(error)}`);
					this.saving = false;
					button.setDisabled(false);
				}
			}));
		actions.addButton((button) => button
			.setButtonText('保存此 thread 模板')
			.setCta()
			.onClick(async () => {
				if (this.saving) return;
				this.saving = true;
				button.setDisabled(true);
				try {
					await this.onSave(normalizeCheckpointFields(this.fields));
					this.close();
				} catch (error) {
					console.error('Thread Journal failed to save checkpoint template', error);
					new Notice(`保存 Checkpoint 模板失败：${String(error)}`);
					this.saving = false;
					button.setDisabled(false);
				}
			}));
	}

	private moveField(field: CheckpointFieldSpec, index: number, direction: -1 | 1): void {
		const otherIndex = index + direction;
		const other = this.fields[otherIndex];
		if (!other || other.deprecated !== field.deprecated) return;
		this.fields[index] = other;
		this.fields[otherIndex] = field;
		this.render();
	}

	private renderFieldSummary(field: CheckpointFieldSpec, index: number): void {
		const previous = this.fields[index - 1];
		const next = this.fields[index + 1];
		const controlNames: Record<CheckpointFieldSpec['control'], string> = {
			text: '单行文本',
			textarea: '多行文本',
			number: '数字',
			toggle: '开关',
			date: '日期',
			select: '选择项',
		};
		const details = [
			field.key,
			controlNames[field.control],
			field.storage === 'inline' ? '可查询字段' : 'Checkpoint 正文',
			field.required ? '必填' : '',
			field.deprecated ? '已废弃' : '',
		].filter(Boolean).join(' · ');
		const card = this.contentEl.createDiv({
			cls: `thread-journal-checkpoint-field-setting is-summary${field.deprecated ? ' is-deprecated' : ''}`,
		});
		new Setting(card)
			.setName(field.label || field.key)
			.setDesc(details)
			.addToggle((toggle) => toggle
				.setTooltip('废弃字段')
				.setValue(field.deprecated)
				.onChange((value) => {
					field.deprecated = value;
					if (value) field.required = false;
					this.fields = placeDeprecatedFieldsLast(this.fields);
					this.render();
				}))
			.addButton((button) => button
				.setButtonText('编辑')
				.onClick(() => void this.openFieldForm(field, index)))
			.addExtraButton((button) => button
				.setIcon('arrow-up')
				.setTooltip('上移')
				.setDisabled(!previous || previous.deprecated !== field.deprecated)
				.onClick(() => this.moveField(field, index, -1)))
			.addExtraButton((button) => button
				.setIcon('arrow-down')
				.setTooltip('下移')
				.setDisabled(!next || next.deprecated !== field.deprecated)
				.onClick(() => this.moveField(field, index, 1)))
			.addExtraButton((button) => button
				.setIcon('trash-2')
				.setTooltip('删除字段')
				.onClick(() => {
					this.fields.splice(index, 1);
					this.render();
				}));
	}

	private async openFieldForm(field: CheckpointFieldSpec, index: number | undefined): Promise<void> {
		if (!this.modalFormApi) return;
		try {
			const values = checkpointTemplateFieldValues(field);
			const result = await this.modalFormApi.openForm(
				buildCheckpointTemplateFieldModalForm(
					index === undefined ? '添加 checkpoint 字段' : '编辑 checkpoint 字段',
				),
				{ values },
			);
			if (result.status !== 'ok') return;
			const nextField = checkpointFieldFromModalData(result.getData(), field);
			if (index === undefined) this.fields.push(nextField);
			else this.fields[index] = nextField;
			this.fields = placeDeprecatedFieldsLast(this.fields);
			this.render();
		} catch (error) {
			console.error('Thread Journal failed to open checkpoint field form', error);
			new Notice(`打开字段表单失败：${String(error)}`);
		}
	}

	private renderField(field: CheckpointFieldSpec, index: number): void {
		const previous = this.fields[index - 1];
		const next = this.fields[index + 1];
		const card = this.contentEl.createDiv({
			cls: `thread-journal-checkpoint-field-setting${field.deprecated ? ' is-deprecated' : ''}`,
		});
		new Setting(card)
			.setName(field.label || field.key)
			.setDesc(`${field.key}${field.deprecated ? ' · 已废弃' : ''}`)
			.addExtraButton((button) => button
				.setIcon('arrow-up')
				.setTooltip('上移')
				.setDisabled(!previous || previous.deprecated !== field.deprecated)
				.onClick(() => {
					if (index === 0) return;
					const previous = this.fields[index - 1];
					if (!previous) return;
					this.fields[index - 1] = field;
					this.fields[index] = previous;
					this.render();
				}))
			.addExtraButton((button) => button
				.setIcon('arrow-down')
				.setTooltip('下移')
				.setDisabled(!next || next.deprecated !== field.deprecated)
				.onClick(() => {
					const next = this.fields[index + 1];
					if (!next) return;
					this.fields[index] = next;
					this.fields[index + 1] = field;
					this.render();
				}))
			.addExtraButton((button) => button
				.setIcon('trash-2')
				.setTooltip('删除字段')
				.onClick(() => {
					this.fields.splice(index, 1);
					this.render();
				}));

		new Setting(card)
			.setName('显示名称')
			.addText((text) => text
				.setValue(field.label)
				.setPlaceholder('摘要')
				.onChange((value) => {
					field.label = value;
				}));

		new Setting(card)
			.setName('字段键')
			.setDesc('用于 dataview 查询；系统保留 checkpoint、checkpoint_date 和 checkpoint_time。')
			.addText((text) => text
				.setValue(field.key)
				.setPlaceholder('字段键')
				.onChange((value) => {
					field.key = value;
				}));

		new Setting(card)
			.setName('控件')
			.addDropdown((dropdown) => dropdown
				.addOption('text', '单行文本')
				.addOption('textarea', '多行文本')
				.addOption('number', '数字')
				.addOption('toggle', '开关')
				.addOption('date', '日期')
				.addOption('select', '选择项')
				.setValue(field.control)
				.onChange((value) => {
					field.control = value as CheckpointFieldSpec['control'];
					if (field.control !== 'select') field.options = [];
					this.render();
				}));

		new Setting(card)
			.setName('保存位置')
			.setDesc('可查询字段写在首行；正文字段适合较长内容。')
			.addDropdown((dropdown) => dropdown
				.addOption('inline', '可查询字段')
				.addOption('body', 'Checkpoint 正文')
				.setValue(field.storage)
				.onChange((value) => {
					field.storage = value as CheckpointFieldSpec['storage'];
				}));

		new Setting(card)
			.setName('必填')
			.addToggle((toggle) => toggle
				.setValue(field.required)
				.setDisabled(field.control === 'toggle' || field.deprecated)
				.onChange((value) => {
					field.required = value;
				}));

		new Setting(card)
			.setName('废弃')
			.setDesc('停止用于新 checkpoint；已有记录仍按实际数据展示。')
			.addToggle((toggle) => toggle
				.setValue(field.deprecated)
				.onChange((value) => {
					field.deprecated = value;
					if (value) field.required = false;
					this.fields = placeDeprecatedFieldsLast(this.fields);
					this.render();
				}));

		if (field.control === 'select') {
			new Setting(card)
				.setName('选项')
				.setDesc('使用英文逗号分隔。')
				.addText((text) => text
					.setValue(field.options.join(', '))
					.setPlaceholder('Milestone, review')
					.onChange((value) => {
						field.options = value.split(',')
							.map((item) => item.trim())
							.filter(Boolean);
					}));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
