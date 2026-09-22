import type {
	CommitFieldControl,
	CommitFieldSpec,
	CommitFieldStorage,
} from './types';
import { t } from './i18n';

export type CommitFieldRenderMode = 'plain' | 'inline-markdown' | 'block-markdown';

export function commitBodyLabels(
	fields: readonly CommitFieldSpec[],
): ReadonlySet<string> {
	return new Set(fields.map((field) => field.label));
}

const FIELD_CONTROLS = new Set<CommitFieldControl>([
	'text',
	'textarea',
	'number',
	'toggle',
	'date',
	'select',
]);

const FIELD_STORAGE = new Set<CommitFieldStorage>(['inline', 'body']);
const RESERVED_KEYS = new Set(['commit', 'commit_date', 'commit_time']);

export const DEFAULT_COMMIT_FIELDS: CommitFieldSpec[] = [
	{
		key: 'commit_summary',
		label: 'Summary',
		control: 'textarea',
		storage: 'body',
		required: true,
		deprecated: false,
		options: [],
	},
	{
		key: 'effort',
		label: 'Effort',
		control: 'select',
		storage: 'inline',
		required: false,
		deprecated: false,
		options: ['quick', 'light', 'normal', 'deep'],
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

export function commitFieldKey(value: unknown, fallback: string): string {
	const raw = textValue(value)
		.replace(/\s+/g, '_')
		.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
	return raw && !RESERVED_KEYS.has(raw) ? raw : fallback;
}

export function cloneDefaultCommitFields(): CommitFieldSpec[] {
	return cloneCommitFields(DEFAULT_COMMIT_FIELDS).map((field) => ({
		...field,
		label: field.key === 'commit_summary' ? t('Summary') : t('Effort'),
	}));
}

export function cloneCommitFields(
	fields: CommitFieldSpec[],
): CommitFieldSpec[] {
	return fields.map((field) => ({
		...field,
		options: [...field.options],
	}));
}

export function commitFieldsForThread(
	value: unknown,
	defaultFields: CommitFieldSpec[],
): CommitFieldSpec[] {
	return Array.isArray(value)
		? normalizeCommitFields(value)
		: cloneCommitFields(defaultFields);
}

export function placeDeprecatedFieldsLast(
	fields: CommitFieldSpec[],
): CommitFieldSpec[] {
	return [
		...fields.filter((field) => !field.deprecated),
		...fields.filter((field) => field.deprecated),
	];
}

export function activeCommitFields(
	fields: CommitFieldSpec[],
): CommitFieldSpec[] {
	return fields.filter((field) => !field.deprecated);
}

export function commitFieldRenderMode(
	field: Pick<CommitFieldSpec, 'control' | 'storage'>,
): CommitFieldRenderMode {
	if (field.control === 'textarea' || field.storage === 'body') {
		return 'block-markdown';
	}
	return field.control === 'text' ? 'inline-markdown' : 'plain';
}

export function normalizeCommitFields(value: unknown): CommitFieldSpec[] {
	if (!Array.isArray(value)) return cloneDefaultCommitFields();
	const seen = new Set<string>();
	const normalized = value.flatMap((item, index) => {
		if (!isRecord(item)) return [];
		const fallback = `commit_field_${index + 1}`;
		let key = commitFieldKey(item.key, fallback);
		if (seen.has(key)) {
			let suffix = 2;
			while (seen.has(`${key}_${suffix}`)) suffix += 1;
			key = `${key}_${suffix}`;
		}
		seen.add(key);
		const rawControl = textValue(item.control) as CommitFieldControl;
		const control = FIELD_CONTROLS.has(rawControl) ? rawControl : 'text';
		const rawStorage = textValue(item.storage) as CommitFieldStorage;
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
