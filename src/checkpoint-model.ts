import type {
	CheckpointFieldControl,
	CheckpointFieldSpec,
	CheckpointFieldStorage,
} from './types';

const FIELD_CONTROLS = new Set<CheckpointFieldControl>([
	'text',
	'textarea',
	'number',
	'toggle',
	'date',
	'select',
]);

const FIELD_STORAGE = new Set<CheckpointFieldStorage>(['inline', 'body']);
const RESERVED_KEYS = new Set(['checkpoint', 'checkpoint_date', 'checkpoint_time']);

export const DEFAULT_CHECKPOINT_FIELDS: CheckpointFieldSpec[] = [
	{
		key: 'checkpoint_kind',
		label: '类型',
		control: 'select',
		storage: 'inline',
		required: true,
		deprecated: false,
		options: ['milestone', 'review'],
	},
	{
		key: 'checkpoint_summary',
		label: '摘要',
		control: 'text',
		storage: 'inline',
		required: true,
		deprecated: false,
		options: [],
	},
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(textValue).filter(Boolean);
	}
	const text = textValue(value);
	return text ? text.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

export function checkpointFieldKey(value: unknown, fallback: string): string {
	const raw = textValue(value)
		.replace(/\s+/g, '_')
		.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
	return raw && !RESERVED_KEYS.has(raw) ? raw : fallback;
}

export function cloneDefaultCheckpointFields(): CheckpointFieldSpec[] {
	return cloneCheckpointFields(DEFAULT_CHECKPOINT_FIELDS);
}

export function cloneCheckpointFields(
	fields: CheckpointFieldSpec[],
): CheckpointFieldSpec[] {
	return fields.map((field) => ({
		...field,
		options: [...field.options],
	}));
}

export function checkpointFieldsForThread(
	value: unknown,
	defaultFields: CheckpointFieldSpec[],
): CheckpointFieldSpec[] {
	return Array.isArray(value)
		? normalizeCheckpointFields(value)
		: cloneCheckpointFields(defaultFields);
}

export function placeDeprecatedFieldsLast(
	fields: CheckpointFieldSpec[],
): CheckpointFieldSpec[] {
	return [
		...fields.filter((field) => !field.deprecated),
		...fields.filter((field) => field.deprecated),
	];
}

export function activeCheckpointFields(
	fields: CheckpointFieldSpec[],
): CheckpointFieldSpec[] {
	return fields.filter((field) => !field.deprecated);
}

export function normalizeCheckpointFields(value: unknown): CheckpointFieldSpec[] {
	if (!Array.isArray(value)) return cloneDefaultCheckpointFields();
	const seen = new Set<string>();
	const normalized = value.flatMap((item, index) => {
		if (!isRecord(item)) return [];
		const fallback = `checkpoint_field_${index + 1}`;
		let key = checkpointFieldKey(item.key, fallback);
		if (seen.has(key)) {
			let suffix = 2;
			while (seen.has(`${key}_${suffix}`)) suffix += 1;
			key = `${key}_${suffix}`;
		}
		seen.add(key);
		const rawControl = textValue(item.control) as CheckpointFieldControl;
		const control = FIELD_CONTROLS.has(rawControl) ? rawControl : 'text';
		const rawStorage = textValue(item.storage) as CheckpointFieldStorage;
		const storage = FIELD_STORAGE.has(rawStorage)
			? rawStorage
			: control === 'textarea' ? 'body' : 'inline';
		const deprecated = item.deprecated === true;
		return [{
			key,
			label: textValue(item.label) || key,
			control,
			storage,
			required: !deprecated && control !== 'toggle' && item.required === true,
			deprecated,
			options: control === 'select' ? stringList(item.options) : [],
		}];
	});
	return placeDeprecatedFieldsLast(normalized);
}
