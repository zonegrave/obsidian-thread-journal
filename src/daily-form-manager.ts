import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { slugify } from './core';
import type {
	DailyFieldControl,
	DailyFieldSpec,
	DailyFormItem,
	DailySectionSpec,
} from './types';

interface ItemDraft {
	kind: 'field' | 'section';
	key: string;
	label: string;
	control: DailyFieldControl;
	unit: string;
	min: string;
	max: string;
	step: string;
	options: string;
}

const FIELD_CONTROLS: Array<{ value: DailyFieldControl; label: string }> = [
	{ value: 'text', label: '短文本' },
	{ value: 'number', label: '数字' },
	{ value: 'toggle', label: '开关' },
	{ value: 'date', label: '日期' },
	{ value: 'datetime', label: '日期与时间' },
	{ value: 'slider', label: '评分滑杆' },
	{ value: 'select', label: '下拉选择' },
	{ value: 'textarea', label: '长纯文本' },
	{ value: 'list', label: '列表' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asDraft(item: DailyFormItem): ItemDraft {
	if (item.kind === 'section') {
		return {
			kind: 'section',
			key: item.id,
			label: item.label,
			control: 'text',
			unit: '',
			min: '',
			max: '',
			step: '',
			options: '',
		};
	}
	return {
		kind: 'field',
		key: item.key,
		label: item.label ?? '',
		control: item.control,
		unit: item.unit ?? '',
		min: item.min?.toString() ?? '',
		max: item.max?.toString() ?? '',
		step: item.step?.toString() ?? '',
		options: item.options?.join(', ') ?? '',
	};
}

function optionalNumber(value: string): number | undefined {
	if (!value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function asFormItem(draft: ItemDraft): DailyFormItem {
	if (draft.kind === 'section') {
		const item: DailySectionSpec = {
			kind: 'section',
			id: slugify(draft.key.trim() || draft.label),
			label: draft.label.trim(),
			storage: 'body',
		};
		return item;
	}
	const item: DailyFieldSpec = {
		kind: 'field',
		key: draft.key.trim(),
		control: draft.control,
	};
	const label = draft.label.trim();
	const unit = draft.unit.trim();
	if (label) item.label = label;
	if (unit) item.unit = unit;
	if (draft.control === 'slider') {
		const min = optionalNumber(draft.min);
		const max = optionalNumber(draft.max);
		const step = optionalNumber(draft.step);
		if (min !== undefined) item.min = min;
		if (max !== undefined) item.max = max;
		if (step !== undefined) item.step = step;
	}
	if (draft.control === 'select') {
		item.options = draft.options
			.split(',')
			.map((option) => option.trim())
			.filter(Boolean);
	}
	return item;
}

function validationError(drafts: ItemDraft[]): string | undefined {
	const fieldKeys = new Set<string>();
	const sectionIds = new Set<string>();
	for (let index = 0; index < drafts.length; index += 1) {
		const draft = drafts[index];
		if (!draft) continue;
		if (draft.kind === 'section') {
			if (!draft.label.trim()) return `第 ${index + 1} 个表单项缺少段落标题。`;
			const id = slugify(draft.key.trim() || draft.label);
			if (sectionIds.has(id)) return `正文段落 ID“${id}”重复。`;
			sectionIds.add(id);
			continue;
		}
		const key = draft.key.trim();
		if (!key) return `第 ${index + 1} 个表单项缺少字段键。`;
		if (['\n', '\r', ':', '[', ']', '^'].some((character) => key.includes(character))) {
			return `字段键“${key}”包含 Meta Bind 不支持的字符。`;
		}
		if (fieldKeys.has(key)) return `字段键“${key}”重复。`;
		fieldKeys.add(key);
		if (draft.control === 'select' && !draft.options.split(',').some((option) => option.trim())) {
			return `下拉字段“${key}”至少需要一个选项。`;
		}
		if (draft.control === 'slider') {
			for (const value of [draft.min, draft.max, draft.step]) {
				if (value.trim() && optionalNumber(value) === undefined) {
					return `滑杆字段“${key}”的范围与步长必须是数字。`;
				}
			}
		}
	}
	return undefined;
}

class DailyFormModal extends Modal {
	private readonly drafts: ItemDraft[];

	constructor(
		app: App,
		private readonly file: TFile,
		form: DailyFormItem[],
		private readonly onSave: (form: DailyFormItem[]) => Promise<void>,
	) {
		super(app);
		this.drafts = form.map(asDraft);
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-fields-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		this.contentEl.empty();
		this.setTitle('管理日记表单');
		this.contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: `${this.file.basename} · 字段由 Meta Bind 写入日记属性，Markdown 段落保存在日记正文。`,
		});

		const list = this.contentEl.createDiv({ cls: 'thread-journal-fields-list' });
		if (this.drafts.length === 0) {
			list.createDiv({
				cls: 'thread-journal-empty thread-journal-fields-empty',
				text: '当前 thread 还没有日记表单。',
			});
		}
		this.drafts.forEach((draft, index) => this.renderItem(list, draft, index));

		const actions = new Setting(this.contentEl).setClass('thread-journal-fields-actions');
		actions.addButton((button) => button
			.setButtonText('新增字段')
			.setIcon('plus')
			.onClick(() => {
				this.drafts.push(this.newDraft('field'));
				this.render();
			}));
		actions.addButton((button) => button
			.setButtonText('新增 Markdown 段落')
			.setIcon('text')
			.onClick(() => {
				this.drafts.push(this.newDraft('section'));
				this.render();
			}));
		actions.addButton((button) => button
			.setButtonText('保存')
			.setCta()
			.onClick(async () => {
				const error = validationError(this.drafts);
				if (error) {
					new Notice(error);
					return;
				}
				try {
					await this.onSave(this.drafts.map(asFormItem));
					this.close();
				} catch (error: unknown) {
					console.error('Thread Journal failed to save daily form', error);
					new Notice(`保存日记表单失败：${String(error)}`);
				}
			}));
	}

	private renderItem(container: HTMLElement, draft: ItemDraft, index: number): void {
		const card = container.createDiv({ cls: 'thread-journal-field-card' });
		card.createDiv({
			cls: 'thread-journal-field-number',
			text: `表单项 ${index + 1}`,
		});

		new Setting(card)
			.setName('项目类型')
			.addDropdown((dropdown) => dropdown
				.addOption('field', '结构化字段')
				.addOption('section', 'Markdown 段落')
				.setValue(draft.kind)
				.onChange((value) => {
					draft.kind = value === 'section' ? 'section' : 'field';
					this.render();
				}));

		new Setting(card)
			.setName(draft.kind === 'field' ? '显示名称' : '段落标题')
			.addText((text) => text
				.setPlaceholder(draft.kind === 'field' ? '例如 睡眠时长' : '例如 睡眠观察')
				.setValue(draft.label)
				.onChange((value) => {
					draft.label = value;
				}));

		if (draft.kind === 'field') this.renderFieldSettings(card, draft);
		else this.renderSectionSettings(card, draft);

		const controls = new Setting(card).setClass('thread-journal-field-controls');
		controls.addButton((button) => button
			.setIcon('arrow-up')
			.setTooltip('上移')
			.setDisabled(index === 0)
			.onClick(() => this.moveItem(index, index - 1)));
		controls.addButton((button) => button
			.setIcon('arrow-down')
			.setTooltip('下移')
			.setDisabled(index === this.drafts.length - 1)
			.onClick(() => this.moveItem(index, index + 1)));
		controls.addButton((button) => button
			.setIcon('trash-2')
			.setTooltip('删除表单项')
			.setWarning()
			.onClick(() => {
				this.drafts.splice(index, 1);
				this.render();
			}));
	}

	private renderFieldSettings(card: HTMLElement, draft: ItemDraft): void {
		new Setting(card)
			.setName('字段键')
			.setDesc('用户填写控件后才会在日记 frontmatter 中创建。')
			.addText((text) => text
				.setPlaceholder('例如 sleep_hours')
				.setValue(draft.key)
				.onChange((value) => {
					draft.key = value;
				}));

		new Setting(card)
			.setName('控件')
			.addDropdown((dropdown) => {
				for (const option of FIELD_CONTROLS) dropdown.addOption(option.value, option.label);
				dropdown.setValue(draft.control).onChange((value) => {
					draft.control = value as DailyFieldControl;
					this.render();
				});
			});

		new Setting(card)
			.setName('单位')
			.setDesc('可选，只用于表单标签。')
			.addText((text) => text
				.setPlaceholder('例如 小时')
				.setValue(draft.unit)
				.onChange((value) => {
					draft.unit = value;
				}));

		if (draft.control === 'slider') {
			for (const [property, name, placeholder] of [
				['min', '最小值', '1'],
				['max', '最大值', '10'],
				['step', '步长', '1'],
			] as const) {
				new Setting(card).setName(name).addText((text) => text
					.setPlaceholder(placeholder)
					.setValue(draft[property])
					.onChange((value) => {
						draft[property] = value;
					}));
			}
		}

		if (draft.control === 'select') {
			new Setting(card)
				.setName('选项')
				.setDesc('使用英文逗号分隔。')
				.addText((text) => text
					.setPlaceholder('低, 中, 高')
					.setValue(draft.options)
					.onChange((value) => {
						draft.options = value;
					}));
		}
	}

	private renderSectionSettings(card: HTMLElement, draft: ItemDraft): void {
		new Setting(card)
			.setName('稳定 ID')
			.setDesc('可选；留空时根据段落标题生成。保存历史记录后不建议修改。')
			.addText((text) => text
				.setPlaceholder('例如 sleep-observation')
				.setValue(draft.key)
				.onChange((value) => {
					draft.key = value;
				}));
	}

	private newDraft(kind: 'field' | 'section'): ItemDraft {
		return {
			kind,
			key: '',
			label: '',
			control: 'text',
			unit: '',
			min: kind === 'field' ? '1' : '',
			max: kind === 'field' ? '10' : '',
			step: kind === 'field' ? '1' : '',
			options: '',
		};
	}

	private moveItem(from: number, to: number): void {
		if (to < 0 || to >= this.drafts.length) return;
		const [draft] = this.drafts.splice(from, 1);
		if (!draft) return;
		this.drafts.splice(to, 0, draft);
		this.render();
	}
}

export class DailyFormManager {
	constructor(private readonly app: App) {}

	open(file: TFile, form: DailyFormItem[]): void {
		new DailyFormModal(this.app, file, form, async (updatedForm) => {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					const currentDaily = isRecord(frontmatter.daily)
						? { ...frontmatter.daily }
						: {};
					currentDaily.form = updatedForm;
					delete currentDaily.fields;
					delete currentDaily.sections;
					frontmatter.daily = currentDaily;
				},
			);
			new Notice(`已保存 ${updatedForm.length} 个日记表单项。`);
		}).open();
	}
}
