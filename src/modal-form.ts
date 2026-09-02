import type { App } from 'obsidian';
import { checkpointFieldKey } from './checkpoint-model';
import type { CheckpointFieldSpec } from './types';

type ModalFormInput =
	| { type: 'text' | 'textarea' | 'number' | 'toggle' | 'date' | 'time'; hidden: false }
	| {
		type: 'select';
		source: 'fixed';
		options: Array<{ value: string; label: string }>;
	};

interface ModalFormField {
	name: string;
	label: string;
	description: string;
	isRequired: boolean;
	input: ModalFormInput;
}

export interface ModalFormDefinition {
	name: string;
	title: string;
	version: '1';
	customClassname: string;
	fields: ModalFormField[];
}

export interface ModalFormResult {
	status: 'ok' | 'cancelled';
	getData(): Record<string, unknown>;
}

export interface ModalFormApi {
	openForm(
		definition: ModalFormDefinition,
		options: { values: Record<string, unknown> },
	): Promise<ModalFormResult>;
}

interface AppWithPlugins extends App {
	plugins?: {
		plugins?: Record<string, { api?: unknown }>;
	};
}

function fieldInput(field: CheckpointFieldSpec, currentValue?: unknown): ModalFormInput {
	if (field.control === 'select') {
		const options = [...field.options];
		if (
			typeof currentValue === 'string'
			&& currentValue
			&& !options.includes(currentValue)
		) {
			options.push(currentValue);
		}
		return {
			type: 'select',
			source: 'fixed',
			options: options.map((option) => ({ value: option, label: option })),
		};
	}
	return { type: field.control, hidden: false };
}

export function buildCheckpointModalForm(
	title: string,
	fields: CheckpointFieldSpec[],
	values: Record<string, unknown> = {},
): ModalFormDefinition {
	return {
		name: 'thread-journal-checkpoint',
		title,
		version: '1',
		customClassname: 'thread-journal-modal-form',
		fields: [
			{
				name: 'checkpoint_date',
				label: '日期',
				description: 'Checkpoint 的发生日期。',
				isRequired: true,
				input: { type: 'date', hidden: false },
			},
			{
				name: 'checkpoint_time',
				label: '时间',
				description: 'Checkpoint 的发生时间。',
				isRequired: true,
				input: { type: 'time', hidden: false },
			},
			...fields.map((field) => ({
				name: field.key,
				label: field.label,
				description: field.storage === 'inline'
					? `可查询字段 · ${field.key}`
					: `Checkpoint 正文 · ${field.key}`,
				isRequired: field.required,
				input: fieldInput(field, values[field.key]),
			})),
		],
	};
}

const CHECKPOINT_CONTROL_OPTIONS = [
	{ value: 'text', label: '单行文本' },
	{ value: 'textarea', label: '多行文本' },
	{ value: 'number', label: '数字' },
	{ value: 'toggle', label: '开关' },
	{ value: 'date', label: '日期' },
	{ value: 'select', label: '选择项' },
];

const CHECKPOINT_STORAGE_OPTIONS = [
	{ value: 'inline', label: '可查询字段' },
	{ value: 'body', label: 'Checkpoint 正文' },
];

export function buildCheckpointTemplateFieldModalForm(
	title: string,
): ModalFormDefinition {
	return {
		name: 'thread-journal-checkpoint-template-field',
		title,
		version: '1',
		customClassname: 'thread-journal-modal-form',
		fields: [
			{
				name: 'label',
				label: '显示名称',
				description: '显示在 checkpoint 表单和卡片中的名称。',
				isRequired: true,
				input: { type: 'text', hidden: false },
			},
			{
				name: 'key',
				label: '字段键',
				description: '用于 Dataview 查询；保存时会自动清理无效字符。',
				isRequired: true,
				input: { type: 'text', hidden: false },
			},
			{
				name: 'control',
				label: '控件',
				description: '填写 checkpoint 时使用的输入控件。',
				isRequired: true,
				input: {
					type: 'select',
					source: 'fixed',
					options: CHECKPOINT_CONTROL_OPTIONS,
				},
			},
			{
				name: 'storage',
				label: '保存位置',
				description: '可查询字段写在首行；正文字段适合较长内容。',
				isRequired: true,
				input: {
					type: 'select',
					source: 'fixed',
					options: CHECKPOINT_STORAGE_OPTIONS,
				},
			},
			{
				name: 'required',
				label: '必填',
				description: '开关字段和废弃字段会在保存时自动取消必填。',
				isRequired: false,
				input: { type: 'toggle', hidden: false },
			},
			{
				name: 'deprecated',
				label: '废弃',
				description: '不再用于新 checkpoint，但保留历史展示语义。',
				isRequired: false,
				input: { type: 'toggle', hidden: false },
			},
			{
				name: 'options',
				label: '选择项',
				description: '仅选择项控件使用；每行一个选项，也支持英文逗号分隔。',
				isRequired: false,
				input: { type: 'textarea', hidden: false },
			},
		],
	};
}

export function checkpointTemplateFieldValues(
	field: CheckpointFieldSpec,
): Record<string, unknown> {
	return {
		label: field.label,
		key: field.key,
		control: field.control,
		storage: field.storage,
		required: field.required,
		deprecated: field.deprecated,
		options: field.options.join('\n'),
	};
}

function textValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
	return value === true || value === 'true';
}

function optionsValue(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => textValue(item)).filter(Boolean);
	}
	return textValue(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function checkpointFieldFromModalData(
	data: Record<string, unknown>,
	fallback: CheckpointFieldSpec,
): CheckpointFieldSpec {
	const rawControl = textValue(data.control);
	const control = ['text', 'textarea', 'number', 'toggle', 'date', 'select'].includes(rawControl)
		? rawControl as CheckpointFieldSpec['control']
		: fallback.control;
	const rawStorage = textValue(data.storage);
	const storage = rawStorage === 'body' || rawStorage === 'inline'
		? rawStorage
		: fallback.storage;
	const deprecated = booleanValue(data.deprecated);
	return {
		key: checkpointFieldKey(data.key, fallback.key),
		label: textValue(data.label) || fallback.label,
		control,
		storage,
		required: !deprecated && control !== 'toggle' && booleanValue(data.required),
		deprecated,
		options: control === 'select' ? optionsValue(data.options) : [],
	};
}

export function getModalFormApi(app: App): ModalFormApi | undefined {
	const candidate = (app as AppWithPlugins).plugins?.plugins?.modalforms?.api;
	if (typeof candidate !== 'object' || candidate === null) return undefined;
	const openForm = (candidate as { openForm?: unknown }).openForm;
	return typeof openForm === 'function' ? candidate as ModalFormApi : undefined;
}
