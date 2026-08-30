import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDailyFormBlock,
	buildDailyTemplateBlock,
	buildDefaultThreadDailyForm,
	buildThreadDailyFormCodeBlock,
	buildThreadFileName,
	buildSectionBlock,
	extractMarkedSection,
	extractMetaBindPropertyKeys,
	extractThreadBodyRecords,
	extractThreadDailyForm,
	hasDailyFormSnapshot,
	insertBlocksUnderHeading,
	metaBindInput,
	neutralizeMetaBindInputs,
	normalizeDailyContribution,
	normalizeRecordsConfig,
	replaceThreadDailyForm,
	stripWikiLink,
	wikiLinkAlias,
} from '../src/core';
import { renderThreadTemplate } from '../src/thread-template';

void test('prefixes new thread file names while preserving a safe title', () => {
	assert.equal(buildThreadFileName('睡眠/管理', '260828'), '260828·睡眠-管理');
	assert.equal(buildThreadFileName('...', '260828'), '');
});

void test('renders a thread template with creation context and kind-aware headings', () => {
	const rendered = renderThreadTemplate([
		'# {{title}}',
		'{{kind}} · {{filename}} · {{thread_id}}',
		'{{parent_title}} {{parent}}',
		'## {{goal_heading}}',
		'## {{criteria_heading}}',
		'{{date}} / {{date:YYMMDD}}',
		'{{unknown}}',
	].join('\n'), {
		title: '睡眠管理',
		fileName: '260828·睡眠管理',
		threadId: 'stable-id',
		kind: 'area',
		parentTitle: '健康管理',
		parentLink: '[[260826·健康管理|健康管理]]',
		created: '2026-08-28',
	}, (format) => format === 'YYMMDD' ? '260828' : '2026-08-28');
	assert.match(rendered, /^# 睡眠管理/m);
	assert.match(rendered, /area · 260828·睡眠管理 · stable-id/);
	assert.match(rendered, /## 责任范围/);
	assert.match(rendered, /## 维持标准/);
	assert.match(rendered, /2026-08-28 \/ 260828/);
	assert.match(rendered, /\{\{unknown\}\}/);
});

void test('extracts dated list records only from the thread record section', () => {
	const records = extractThreadBodyRecords([
		'## 每日记录模板',
		'```thread-record-template',
		'- [thread_record:: true] [record_date:: 2026-08-30] [summary:: 模板不应被读取]',
		'```',
		'',
		'## 记录',
		'',
		'- [thread_record:: true] [record_date:: 2026-08-30] [sleep_hours:: 7.5] [summary:: 入睡顺利] ^rec-260830-a',
		'  - 夜间醒来一次。',
		'- 普通列表项',
		'- [thread_record:: true] [record_date:: 2026-08-29] [sleep_hours:: 6.8] 睡眠不足',
		'',
		'## 其他',
		'- [thread_record:: true] [record_date:: 2026-08-28] [summary:: 其他章节]',
	].join('\n'));
	assert.equal(records.length, 2);
	assert.deepEqual(records[0], {
		date: '2026-08-30',
		line: 8,
		blockId: 'rec-260830-a',
		fields: [
			{ key: 'thread_record', value: true },
			{ key: 'record_date', value: '2026-08-30' },
			{ key: 'sleep_hours', value: 7.5 },
			{ key: 'summary', value: '入睡顺利' },
		],
		body: '入睡顺利\n- 夜间醒来一次。',
	});
	assert.equal(records[1]?.date, '2026-08-29');
	assert.equal(records[1]?.body, '睡眠不足');
});

void test('ignores records with a missing or placeholder date', () => {
	const records = extractThreadBodyRecords([
		'## 记录',
		'- [thread_record:: true] [record_date:: YYYY-MM-DD] [summary:: 空模板]',
		'- [thread_record:: true] [summary:: 缺少日期]',
	].join('\n'));
	assert.deepEqual(records, []);
});

void test('normalizes an opt-in daily contribution', () => {
	assert.deepEqual(normalizeDailyContribution({
		form: [
			{ kind: 'field', key: 'sleep_hours', control: 'number', label: '睡眠时长', unit: '小时' },
			{ kind: 'field', key: 'sleep_quality', control: 'slider', min: 1, max: 10, step: 1 },
			{ kind: 'section', id: 'sleep-note', label: '睡眠观察' },
		],
	}), {
		enabled: true,
		form: [
			{
				kind: 'field', key: 'sleep_hours', control: 'number', label: '睡眠时长',
				unit: '小时', min: undefined, max: undefined, step: undefined, options: [],
			},
			{
				kind: 'field', key: 'sleep_quality', control: 'slider', label: undefined,
				unit: undefined, min: 1, max: 10, step: 1, options: [],
			},
			{ kind: 'section', id: 'sleep-note', label: '睡眠观察', storage: 'body' },
		],
		fields: [
			{
				kind: 'field', key: 'sleep_hours', control: 'number', label: '睡眠时长',
				unit: '小时', min: undefined, max: undefined, step: undefined, options: [],
			},
			{
				kind: 'field', key: 'sleep_quality', control: 'slider', label: undefined,
				unit: undefined, min: 1, max: 10, step: 1, options: [],
			},
		],
		sections: [
			{ kind: 'section', id: 'sleep-note', label: '睡眠观察', storage: 'body' },
		],
	});
});

void test('normalizes legacy daily.form for migration and fallback composition', () => {
	assert.equal(normalizeDailyContribution({ form: [] }).enabled, false);
	assert.equal(normalizeDailyContribution({ fields: ['legacy'] }).enabled, false);
	assert.equal(normalizeDailyContribution({
		enabled: false,
		form: [{ kind: 'field', key: 'x', control: 'text' }],
	}).enabled, false);
});

void test('inserts marked sections under 今日记录 and stays idempotent', () => {
	const block = buildSectionBlock('sleep-thread', {
		kind: 'section', id: 'observation', label: '睡眠观察', storage: 'body',
	});
	const original = '# 2026-08-27\n\n## 今日记录\n\n- 原有内容\n\n## 今日收尾\n';
	const first = insertBlocksUnderHeading(original, '今日记录', [block]);
	assert.equal(first.inserted, 1);
	assert.ok(first.content.indexOf('睡眠观察') < first.content.indexOf('## 今日收尾'));
	const second = insertBlocksUnderHeading(first.content, '今日记录', [block]);
	assert.equal(second.inserted, 0);
	assert.equal(second.content, first.content);
});

void test('creates the target heading when a daily template does not provide it', () => {
	const block = buildSectionBlock('exercise', {
		kind: 'section', id: 'note', label: '运动观察', storage: 'body',
	});
	const result = insertBlocksUnderHeading('# 2026-08-27\n', '今日记录', [block]);
	assert.equal(result.inserted, 1);
	assert.match(result.content, /## 今日记录\n\n<!-- thread-journal/);
});

void test('extracts user text while removing the generated heading', () => {
	const block = buildSectionBlock('sleep-thread', {
		kind: 'section', id: 'observation', label: '睡眠观察', storage: 'body',
	})
		.replace('\n\n<!-- thread-journal', '\n\n今天睡得不错。\n\n<!-- thread-journal');
	assert.equal(extractMarkedSection(block, 'sleep-thread', 'observation'), '今天睡得不错。');
});

void test('generates Meta Bind controls and a stable thread snapshot', () => {
	const form = normalizeDailyContribution({
		form: [
			{ kind: 'field', key: 'sleep_hours', label: '睡眠时长', control: 'number', unit: '小时' },
			{ kind: 'field', key: 'sleep_quality', control: 'slider', min: 1, max: 10, step: 1 },
			{ kind: 'section', id: 'note', label: '睡眠观察' },
		],
	}).form;
	const block = buildDailyFormBlock('sleep-thread', '睡眠管理', form);
	assert.match(block, /INPUT\[number:sleep_hours\]/);
	assert.match(block, /INPUT\[slider\(addLabels, minValue\(1\), maxValue\(10\), stepSize\(1\)\):sleep_quality\]/);
	assert.match(block, /#### 睡眠观察/);
	assert.equal(hasDailyFormSnapshot(block, 'sleep-thread'), true);
	assert.equal(insertBlocksUnderHeading('## 今日记录\n', '今日记录', [block]).inserted, 1);
});

void test('quotes Meta Bind select options', () => {
	assert.equal(metaBindInput({
		kind: 'field',
		key: 'energy',
		control: 'select',
		options: ['低', "今天's 高"],
	}), "INPUT[inlineSelect(option('低'), option('今天\\'s 高')):energy]");
});

void test('normalizes record view config', () => {
	assert.deepEqual(normalizeRecordsConfig({
		scope: 'self',
		days: '7',
		fields: ['energy'],
		sections: ['Sleep note'],
		'show-empty': true,
	}), {
		scope: 'self',
		days: 7,
		fields: ['energy'],
		sections: ['sleep-note'],
		showEmpty: true,
	});
});

void test('resolves the target part of a wikilink', () => {
	assert.equal(stripWikiLink('[[睡眠管理#记录|睡眠]]'), '睡眠管理');
});

void test('reads the display alias from a parent wikilink', () => {
	assert.equal(wikiLinkAlias('[[260826·睡眠管理|睡眠管理]]'), '睡眠管理');
	assert.equal(wikiLinkAlias('[[260826·睡眠管理]]'), undefined);
});

void test('extracts a custom Meta Bind form from the thread body', () => {
	const template = [
		'> [!note]+ 睡眠',
		'> **时长** `INPUT[number:sleep_hours]`',
	].join('\n');
	const block = buildThreadDailyFormCodeBlock(template);
	assert.equal(extractThreadDailyForm(`# 睡眠\n\n${block}\n`), template);
});

void test('replaces only the editable body of an existing thread form', () => {
	const original = '# Thread\n\n```thread-daily-form\n> old\n```\n\n## End\n';
	const updated = replaceThreadDailyForm(original, '> [!note]+ 新表单\n> new');
	assert.equal(updated, '# Thread\n\n```thread-daily-form\n> [!note]+ 新表单\n> new\n```\n\n## End\n');
	assert.equal(extractThreadDailyForm(updated ?? ''), '> [!note]+ 新表单\n> new');
});

void test('copies the custom form into a stable daily snapshot', () => {
	const template = '> [!note]+ 睡眠\n> `INPUT[number:sleep_hours]`';
	const block = buildDailyTemplateBlock('sleep-thread', template);
	assert.match(block, /thread-journal:form:sleep-thread:start/);
	assert.match(block, /\[!note\]\+ 睡眠/);
	assert.equal(hasDailyFormSnapshot(block, 'sleep-thread'), true);
});

void test('discovers Meta Bind property keys in a custom form', () => {
	const template = [
		'`INPUT[number:sleep_hours]`',
		"`INPUT[inlineSelect(option('低'), option('高')):energy]`",
		'`INPUT[number:sleep_hours]`',
	].join('\n');
	assert.deepEqual(extractMetaBindPropertyKeys(template), ['sleep_hours', 'energy']);
});

void test('renders a safe thread preview without live Meta Bind inputs', () => {
	const preview = neutralizeMetaBindInputs('> **时长** `INPUT[number:sleep_hours]`');
	assert.equal(preview, '> **时长** `预览：sleep_hours`');
	assert.doesNotMatch(preview, /INPUT\[/);
	assert.match(buildDefaultThreadDailyForm('睡眠 管理'), /睡眠_管理_记录/);
});
