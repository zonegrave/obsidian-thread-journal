import type {
	DailyContribution,
	DailyFieldControl,
	DailyFieldSpec,
	DailyFormItem,
	DailySectionSpec,
	ThreadRecordsConfig,
} from './types';

const DEFAULT_RECORD_DAYS = 30;

export function buildThreadFileName(title: string, datePrefix: string): string {
	const safeTitle = title
		.trim()
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\.+$/g, '')
		.trim();
	return safeTitle ? `${datePrefix}·${safeTitle}` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function stringList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(asString).filter((item): item is string => Boolean(item));
	}
	const single = asString(value);
	return single ? [single] : [];
}

export function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '') || 'section';
}

const FIELD_CONTROLS = new Set<DailyFieldControl>([
	'text',
	'number',
	'toggle',
	'date',
	'datetime',
	'slider',
	'select',
	'textarea',
	'list',
]);

function normalizeField(value: Record<string, unknown>): DailyFieldSpec | undefined {
	const key = asString(value.key);
	if (!key || ['\n', '\r', ':', '[', ']', '^'].some((character) => key.includes(character))) {
		return undefined;
	}
	const rawControl = asString(value.control)?.toLocaleLowerCase();
	const control: DailyFieldControl = rawControl && FIELD_CONTROLS.has(rawControl as DailyFieldControl)
		? rawControl as DailyFieldControl
		: 'text';
	return {
		kind: 'field',
		key,
		label: asString(value.label),
		control,
		unit: asString(value.unit),
		min: asNumber(value.min),
		max: asNumber(value.max),
		step: asNumber(value.step),
		options: stringList(value.options),
	};
}

function normalizeSection(value: Record<string, unknown>): DailySectionSpec | undefined {
	const label = asString(value.label);
	if (!label) return undefined;
	return {
		kind: 'section',
		id: slugify(asString(value.id) ?? label),
		label,
		storage: 'body',
	};
}

function normalizeFormItem(value: unknown): DailyFormItem | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind === 'field') return normalizeField(value);
	if (value.kind === 'section') return normalizeSection(value);
	return undefined;
}

export function normalizeDailyContribution(value: unknown): DailyContribution {
	if (!isRecord(value) || value.enabled === false) {
		return { enabled: false, form: [], fields: [], sections: [] };
	}
	const form = Array.isArray(value.form)
		? value.form.map(normalizeFormItem).filter((item): item is DailyFormItem => Boolean(item))
		: [];
	const fields = form.filter((item): item is DailyFieldSpec => item.kind === 'field');
	const sections = form.filter((item): item is DailySectionSpec => item.kind === 'section');
	return {
		enabled: form.length > 0,
		form,
		fields,
		sections,
	};
}

export function stripWikiLink(value: unknown): string | undefined {
	if (Array.isArray(value)) return stripWikiLink(value[0]);
	if (typeof value !== 'string') return undefined;
	let link = value.trim();
	if (!link) return undefined;
	if (link.startsWith('[[') && link.endsWith(']]')) {
		link = link.slice(2, -2);
	}
	link = link.split('|', 1)[0]?.split('#', 1)[0]?.trim() ?? '';
	return link || undefined;
}

export function wikiLinkAlias(value: unknown): string | undefined {
	if (Array.isArray(value)) return wikiLinkAlias(value[0]);
	if (typeof value !== 'string') return undefined;
	let link = value.trim();
	if (!link) return undefined;
	if (link.startsWith('[[') && link.endsWith(']]')) {
		link = link.slice(2, -2);
	}
	const separator = link.indexOf('|');
	if (separator < 0) return undefined;
	const alias = link.slice(separator + 1).trim();
	return alias || undefined;
}

function markerPart(value: string): string {
	return encodeURIComponent(value);
}

export function sectionMarkers(threadId: string, sectionId: string): { start: string; end: string } {
	const key = `${markerPart(threadId)}:${markerPart(sectionId)}`;
	return {
		start: `<!-- thread-journal:section:${key}:start -->`,
		end: `<!-- thread-journal:section:${key}:end -->`,
	};
}

export function buildSectionBlock(
	threadId: string,
	section: DailySectionSpec,
	headingLevel = 3,
): string {
	const markers = sectionMarkers(threadId, section.id);
	const hashes = '#'.repeat(Math.max(1, Math.min(6, headingLevel)));
	return `${markers.start}\n${hashes} ${section.label}\n\n${markers.end}`;
}

export function dailyFormMarkers(threadId: string): { start: string; end: string } {
	const key = markerPart(threadId);
	return {
		start: `<!-- thread-journal:form:${key}:start -->`,
		end: `<!-- thread-journal:form:${key}:end -->`,
	};
}

export function hasDailyFormSnapshot(content: string, threadId: string): boolean {
	return content.includes(dailyFormMarkers(threadId).start);
}

function metaBindString(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function metaBindInput(field: DailyFieldSpec): string {
	let declaration: string;
	switch (field.control) {
		case 'datetime':
			declaration = 'dateTime';
			break;
		case 'textarea':
			declaration = 'textArea';
			break;
		case 'select': {
			const options = field.options?.map((option) => `option(${metaBindString(option)})`) ?? [];
			declaration = options.length > 0 ? `inlineSelect(${options.join(', ')})` : 'text';
			break;
		}
		case 'slider': {
			const args = ['addLabels'];
			if (field.min !== undefined) args.push(`minValue(${field.min})`);
			if (field.max !== undefined) args.push(`maxValue(${field.max})`);
			if (field.step !== undefined) args.push(`stepSize(${field.step})`);
			declaration = `slider(${args.join(', ')})`;
			break;
		}
		default:
			declaration = field.control;
	}
	return `INPUT[${declaration}:${field.key}]`;
}

export function buildDailyFormBlock(
	threadId: string,
	threadTitle: string,
	form: DailyFormItem[],
	excludedFieldKeys: ReadonlySet<string> = new Set<string>(),
): string {
	const markers = dailyFormMarkers(threadId);
	const items = form.flatMap((item) => {
		if (item.kind === 'section') return [buildSectionBlock(threadId, item, 4)];
		if (excludedFieldKeys.has(item.key)) return [];
		const label = item.label ?? item.key;
		const unit = item.unit ? `（${item.unit}）` : '';
		return [`**${label}${unit}**\n\n\`${metaBindInput(item)}\``];
	});
	return [
		markers.start,
		`### ${threadTitle.replace(/[\n\r]+/g, ' ')}`,
		...items,
		markers.end,
	].join('\n\n');
}

export function extractThreadDailyForm(content: string): string | undefined {
	const lines = content.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const opening = lines[index]?.match(/^\s*(`{3,}|~{3,})\s*thread-daily-form\s*$/i);
		const fence = opening?.[1];
		if (!fence || new Set(fence).size !== 1) continue;
		const fenceCharacter = fence[0];
		if (!fenceCharacter) continue;
		for (let closing = index + 1; closing < lines.length; closing += 1) {
			const candidate = lines[closing]?.trim() ?? '';
			if (candidate.length < fence.length) continue;
			if ([...candidate].every((character) => character === fenceCharacter)) {
				const template = lines.slice(index + 1, closing).join('\n').trim();
				return template || undefined;
			}
		}
	}
	return undefined;
}

export function buildThreadDailyFormCodeBlock(template: string): string {
	return ['```thread-daily-form', template.trim(), '```'].join('\n');
}

export function buildDefaultThreadDailyForm(threadTitle: string): string {
	const title = threadTitle.replace(/[\n\r]+/g, ' ').trim();
	const key = `${slugify(title).replace(/-/g, '_')}_记录`;
	return [
		`> [!note]+ ${title}`,
		`> **记录** \`INPUT[text:${key}]\``,
	].join('\n');
}

export function buildLegacyThreadDailyForm(
	threadTitle: string,
	form: DailyFormItem[],
): string {
	const title = threadTitle.replace(/[\n\r]+/g, ' ').trim();
	const lines = [`> [!note]+ ${title}`];
	for (const item of form) {
		lines.push('>');
		if (item.kind === 'section') {
			lines.push(`> **${item.label}**`, '>');
			continue;
		}
		const label = item.label ?? item.key;
		const unit = item.unit ? `（${item.unit}）` : '';
		lines.push(`> **${label}${unit}** \`${metaBindInput(item)}\``);
	}
	return lines.join('\n');
}

export function buildDailyTemplateBlock(threadId: string, template: string): string {
	const markers = dailyFormMarkers(threadId);
	return [markers.start, template.trim(), markers.end].join('\n');
}

export function extractMetaBindPropertyKeys(template: string): string[] {
	const keys = new Set<string>();
	for (const match of template.matchAll(/INPUT\[([^\]\r\n]+)\]/g)) {
		const declaration = match[1] ?? '';
		const separator = declaration.lastIndexOf(':');
		if (separator < 0) continue;
		const key = declaration.slice(separator + 1).trim();
		if (key) keys.add(key);
	}
	return [...keys];
}

export function neutralizeMetaBindInputs(template: string): string {
	return template.replace(/`?INPUT\[([^\]\r\n]+)\]`?/g, (_match, declaration: string) => {
		const separator = declaration.lastIndexOf(':');
		const key = separator >= 0 ? declaration.slice(separator + 1).trim() : '未绑定';
		return `\`预览：${key}\``;
	});
}

export function extractMarkedSection(
	content: string,
	threadId: string,
	sectionId: string,
): string | undefined {
	const markers = sectionMarkers(threadId, sectionId);
	const start = content.indexOf(markers.start);
	if (start < 0) return undefined;
	const bodyStart = start + markers.start.length;
	const end = content.indexOf(markers.end, bodyStart);
	if (end < 0) return undefined;
	const raw = content.slice(bodyStart, end).trim();
	return raw.replace(/^#{1,6}\s+.*(?:\r?\n|$)/, '').trim();
}

function ensureTrailingNewline(value: string): string {
	return value.endsWith('\n') ? value : `${value}\n`;
}

export function insertBlocksUnderHeading(
	content: string,
	heading: string,
	blocks: string[],
): { content: string; inserted: number } {
	const missing = blocks.filter((block) => {
		const marker = block.match(/^<!-- thread-journal:(?:section|form):.*:start -->/)?.[0];
		return marker ? !content.includes(marker) : true;
	});
	if (missing.length === 0) return { content, inserted: 0 };

	const addition = missing.join('\n\n');
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const headingPattern = new RegExp(`^##\\s+${escapedHeading}\\s*$`, 'm');
	const headingMatch = headingPattern.exec(content);

	if (!headingMatch) {
		const base = ensureTrailingNewline(content.trimEnd());
		return {
			content: `${base}\n## ${heading}\n\n${addition}\n`,
			inserted: missing.length,
		};
	}

	const sectionBodyStart = headingMatch.index + headingMatch[0].length;
	const nextHeadingPattern = /^##\s+/gm;
	nextHeadingPattern.lastIndex = sectionBodyStart;
	const nextHeading = nextHeadingPattern.exec(content);
	const insertAt = nextHeading?.index ?? content.length;
	const before = content.slice(0, insertAt).trimEnd();
	const after = content.slice(insertAt).trimStart();
	const merged = `${before}\n\n${addition}\n\n${after}`.trimEnd();
	return { content: `${merged}\n`, inserted: missing.length };
}

export function normalizeRecordsConfig(value: unknown): ThreadRecordsConfig {
	const config = isRecord(value) ? value : {};
	const parsedDays = typeof config.days === 'number'
		? config.days
		: Number.parseInt(asString(config.days) ?? '', 10);
	return {
		scope: config.scope === 'self' ? 'self' : 'descendants',
		days: Number.isFinite(parsedDays) && parsedDays > 0 ? Math.floor(parsedDays) : DEFAULT_RECORD_DAYS,
		fields: stringList(config.fields),
		sections: stringList(config.sections).map(slugify),
		showEmpty: config.showEmpty === true || config['show-empty'] === true,
	};
}

export function valueIsPresent(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}
