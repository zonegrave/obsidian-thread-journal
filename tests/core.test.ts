import assert from 'node:assert/strict';
import test from 'node:test';
import {
	appendCheckpointEntry,
	buildCheckpointEntry,
	checkpointEditState,
	checkpointEntryAroundLine,
	checkpointEntriesForDate,
	deleteCheckpointEntry,
	insertCheckpointEntryAtLine,
	parseCheckpointEntries,
	replaceCheckpointEntry,
} from '../src/checkpoint-core';
import {
	activeCheckpointFields,
	checkpointFieldsForThread,
	DEFAULT_CHECKPOINT_FIELDS,
	normalizeCheckpointFields,
} from '../src/checkpoint-model';
import {
	buildThreadFileName,
	buildWorkspaceBody,
	buildWorkspaceFileName,
	isContextHeading,
	normalizeWorkspaceSuffix,
	stripWikiLink,
	wikiLinkAlias,
} from '../src/core';
import { DEFAULT_THREAD_TEMPLATE, renderThreadTemplate } from '../src/thread-template';
import { ThreadIndex } from '../src/thread-index';
import {
	buildInlineLogEdit,
	inlineLogEntriesForDate,
	parseInlineLogEntries,
} from '../src/inline-log';
import {
	buildCheckpointModalForm,
	buildCheckpointTemplateFieldModalForm,
	checkpointFieldFromModalData,
	checkpointTemplateFieldValues,
} from '../src/modal-form';
import { THREAD_STATUS_CHOICES, threadStatusLabel } from '../src/thread-status-model';

void test('builds current thread and workspace file names', () => {
	assert.equal(buildThreadFileName('睡眠/管理', '260831'), '260831·睡眠-管理');
	assert.equal(buildThreadFileName('...', '260831'), '');
	assert.equal(buildWorkspaceFileName('260831·睡眠管理'), '260831·睡眠管理·工作区');
	assert.equal(buildWorkspaceFileName('260831·睡眠管理', '草稿/区'), '260831·睡眠管理·草稿-区');
	assert.equal(normalizeWorkspaceSuffix(' ·研究/空间. '), '研究-空间');
	assert.equal(buildWorkspaceBody('睡眠\n管理'), '# 睡眠 管理 · Thread 工作区\n');
});

void test('builds a queryable inline log callout at the cursor line', () => {
	assert.deepEqual(
		buildInlineLogEdit('  ', '09-04 14:35', '2026-09-04T14:35:27'),
		{
			replacement: [
				'  > [!thread-log] 进度 · 09-04 14:35',
				'  > - (thread_log:: 2026-09-04T14:35:27) ',
			].join('\n'),
			fromCh: 0,
			toCh: 2,
			cursorLineOffset: 1,
			cursorCh: 41,
		},
	);
	assert.deepEqual(
		buildInlineLogEdit('已有内容', '09-04 14:35', '2026-09-04T14:35:27'),
		{
			replacement: [
				'',
				'',
				'> [!thread-log] 进度 · 09-04 14:35',
				'> - (thread_log:: 2026-09-04T14:35:27) ',
			].join('\n'),
			fromCh: 4,
			toCh: 4,
			cursorLineOffset: 3,
			cursorCh: 39,
		},
	);
});

void test('parses current and legacy inline logs for a daily summary', () => {
	const content = [
		'> [!thread-log] 进度 · 09-04 14:35',
		'> - (thread_log:: 2026-09-04T14:35:27) 完成了 [[接口验证]]',
		'> [!thread-log] 2026-09-04T07:41:06',
		'> - [thread_log:: 2026-09-04T07:41:06]  改成双向切换',
		'- (thread_log:: 2026-09-03T23:10:00) 昨天的记录',
		'普通文本 (thread_log:: 2026-09-04T12:00:00)',
	].join('\n');

	assert.deepEqual(parseInlineLogEntries(content), [
		{
			timestamp: '2026-09-04T14:35:27',
			date: '2026-09-04',
			time: '14:35',
			text: '完成了 [[接口验证]]',
		},
		{
			timestamp: '2026-09-04T07:41:06',
			date: '2026-09-04',
			time: '07:41',
			text: '改成双向切换',
		},
		{
			timestamp: '2026-09-03T23:10:00',
			date: '2026-09-03',
			time: '23:10',
			text: '昨天的记录',
		},
	]);
	assert.deepEqual(
		inlineLogEntriesForDate(content, '2026-09-04').map((entry) => entry.time),
		['07:41', '14:35'],
	);
});

void test('recognizes current and legacy Context headings', () => {
	assert.equal(isContextHeading('当前 Context'), true);
	assert.equal(isContextHeading('context'), true);
	assert.equal(isContextHeading('  CONTEXT  '), true);
	assert.equal(isContextHeading('Context 说明'), false);
});

void test('pairs renamed thread workspaces by thread_id instead of file links', () => {
	const threadFile = { path: '50-行动系统/renamed-thread.md', basename: 'renamed-thread' };
	const staleNameWorkspace = {
		path: '50-行动系统/工作区/old-thread·工作区.md',
		basename: 'old-thread·工作区',
	};
	const renamedWorkspace = {
		path: '50-行动系统/工作区/custom-workspace-name.md',
		basename: 'custom-workspace-name',
	};
	const frontmatter = new Map<unknown, Record<string, unknown>>([
		[threadFile, {
			type: 'thread', thread_id: 'thread-1', title: '已改名 thread',
			workspace: '[[old-thread·工作区|工作区]]',
		}],
		[staleNameWorkspace, { type: 'thread-workspace', thread_id: 'another-thread' }],
		[renamedWorkspace, { type: 'thread-workspace', thread_id: 'thread-1' }],
	]);
	const app = {
		vault: {
			getMarkdownFiles: () => [threadFile, staleNameWorkspace, renamedWorkspace],
		},
		metadataCache: {
			getFileCache: (file: unknown) => ({ frontmatter: frontmatter.get(file) }),
		},
	};
	const index = new ThreadIndex(app as never);
	assert.equal(index.getWorkspace(threadFile as never), renamedWorkspace);
	assert.equal(index.getThreadForWorkspace(renamedWorkspace as never), threadFile);
});

void test('keeps only the current main thread structure in the default template', () => {
	assert.match(DEFAULT_THREAD_TEMPLATE, /## Milestones/);
	assert.match(DEFAULT_THREAD_TEMPLATE, /## 当前 Context/);
	assert.match(DEFAULT_THREAD_TEMPLATE, /\*\*继续：\*\*/);
	assert.match(DEFAULT_THREAD_TEMPLATE, /### Checkpoints/);
	assert.match(DEFAULT_THREAD_TEMPLATE, /```thread-checkpoints/);
});

void test('renders the current template placeholders', () => {
	const rendered = renderThreadTemplate([
		'# {{title}}',
		'{{kind}} · {{filename}} · {{thread_id}}',
		'{{parent_title}} {{parent}}',
		'{{date}} / {{date:YYMMDD}}',
	].join('\n'), {
		title: '睡眠管理',
		fileName: '260831·睡眠管理',
		threadId: 'stable-id',
		kind: 'area',
		parentTitle: '健康管理',
		parentLink: '[[260826·健康管理|健康管理]]',
		created: '2026-08-31',
	}, (format) => format === 'YYMMDD' ? '260831' : '2026-08-31');
	assert.match(rendered, /^# 睡眠管理/m);
	assert.match(rendered, /area · 260831·睡眠管理 · stable-id/);
	assert.match(rendered, /2026-08-31 \/ 260831/);
});

void test('normalizes configurable checkpoint fields and protects system keys', () => {
	assert.deepEqual(
		DEFAULT_CHECKPOINT_FIELDS.map((field) => field.key),
		['checkpoint_kind', 'checkpoint_summary'],
	);
	assert.deepEqual(normalizeCheckpointFields([
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline', required: true,
		},
		{
			key: 'checkpoint_time', label: '备注', control: 'textarea', storage: 'body', required: false,
		},
	]), [
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline',
			required: true, deprecated: false, options: [],
		},
		{
			key: 'checkpoint_field_2', label: '备注', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		},
	]);
});

void test('uses a per-thread checkpoint template before the global default', () => {
	const defaults = normalizeCheckpointFields(undefined);
	assert.deepEqual(
		checkpointFieldsForThread(undefined, defaults).map((field) => field.key),
		['checkpoint_kind', 'checkpoint_summary'],
	);
	assert.deepEqual(checkpointFieldsForThread([], defaults), []);
	assert.deepEqual(
		checkpointFieldsForThread([{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body', required: false,
		}], defaults),
		[{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		}],
	);
});

void test('moves deprecated fields last and excludes them from new checkpoint input', () => {
	const fields = normalizeCheckpointFields([
		{
			key: 'old_metric', label: '旧指标', control: 'number', storage: 'inline',
			required: true, deprecated: true,
		},
		{
			key: 'current_metric', label: '当前指标', control: 'number', storage: 'inline',
			required: false,
		},
	]);
	assert.deepEqual(fields.map((field) => field.key), ['current_metric', 'old_metric']);
	assert.equal(fields[1]?.deprecated, true);
	assert.equal(fields[1]?.required, false);
	assert.deepEqual(
		activeCheckpointFields(fields).map((field) => field.key),
		['current_metric'],
	);
});

void test('maps checkpoint fields to a Modal Form inline definition', () => {
	const definition = buildCheckpointModalForm('创建 checkpoint', normalizeCheckpointFields([
		{
			key: 'checkpoint_kind', label: '类型', control: 'select', storage: 'inline',
			required: true, options: ['milestone', 'review'],
		},
		{
			key: 'notes', label: '说明', control: 'textarea', storage: 'body', required: false,
		},
	]), { checkpoint_kind: 'custom-review' });
	assert.equal(definition.customClassname, 'thread-journal-modal-form');
	assert.deepEqual(definition.fields.map((field) => field.input.type), [
		'date', 'time', 'select', 'textarea',
	]);
	assert.deepEqual(definition.fields[2]?.input, {
		type: 'select',
		source: 'fixed',
		options: [
			{ value: 'milestone', label: 'milestone' },
			{ value: 'review', label: 'review' },
			{ value: 'custom-review', label: 'custom-review' },
		],
	});
});

void test('builds a Modal Form checkpoint template field editor', () => {
	const definition = buildCheckpointTemplateFieldModalForm('编辑 checkpoint 字段');
	assert.equal(definition.title, '编辑 checkpoint 字段');
	assert.deepEqual(
		definition.fields.map((field) => [field.name, field.input.type]),
		[
			['label', 'text'],
			['key', 'text'],
			['control', 'select'],
			['storage', 'select'],
			['required', 'toggle'],
			['options', 'textarea'],
		],
	);
	assert.deepEqual(checkpointTemplateFieldValues({
		key: 'checkpoint_kind',
		label: '类型',
		control: 'select',
		storage: 'inline',
		required: true,
		deprecated: false,
		options: ['milestone', 'review'],
	}), {
		key: 'checkpoint_kind',
		label: '类型',
		control: 'select',
		storage: 'inline',
		required: true,
		options: 'milestone\nreview',
	});
	assert.deepEqual(checkpointFieldFromModalData({
		label: '新的类型',
		key: 'new kind',
		control: 'select',
		storage: 'inline',
		required: true,
		deprecated: true,
		options: 'milestone\nreview, archived',
	}, DEFAULT_CHECKPOINT_FIELDS[0]!), {
		key: 'new_kind',
		label: '新的类型',
		control: 'select',
		storage: 'inline',
		required: false,
		deprecated: true,
		options: ['milestone', 'review', 'archived'],
	});
	assert.equal(checkpointFieldFromModalData({
		label: '旧字段',
		key: 'old_field',
		control: 'text',
		storage: 'inline',
		required: true,
	}, {
		...DEFAULT_CHECKPOINT_FIELDS[0]!,
		deprecated: true,
	}).deprecated, true);
});

void test('builds a Dataview-queryable checkpoint with a free-form body', () => {
	const fields = normalizeCheckpointFields([
		{
			key: 'checkpoint_kind', label: '类型', control: 'select', storage: 'inline',
			required: true, options: ['milestone', 'review'],
		},
		{
			key: 'checkpoint_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
		{
			key: 'checkpoint_result', label: '阶段成果', control: 'textarea', storage: 'body',
			required: false,
		},
	]);
	assert.equal(buildCheckpointEntry({
		date: '2026-08-31',
		time: '14:35',
		blockId: 'cp-20260831-01',
		fields,
		values: {
			checkpoint_kind: 'milestone',
			checkpoint_summary: '完成表单设计',
			checkpoint_result: '可以自由配置字段。\n长文字保留在正文。',
		},
	}), [
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_time:: 14:35] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成表单设计] ^cp-20260831-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
});

void test('parses checkpoint data from a workspace callout', () => {
	const parsed = parseCheckpointEntries([
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_time:: 14:35] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成表单设计] ^cp-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
	assert.deepEqual(parsed, [{
		blockId: 'cp-01',
		values: {
			checkpoint: 'true',
			checkpoint_date: '2026-08-31',
			checkpoint_time: '14:35',
			checkpoint_kind: 'milestone',
			checkpoint_summary: '完成表单设计',
		},
		body: [{
			label: '阶段成果',
			value: '可以自由配置字段。\n长文字保留在正文。',
		}],
	}]);
});

void test('finds the checkpoint around a Live Preview source line', () => {
	const content = [
		'# Thread 工作区',
		'',
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_summary:: 完成] ^cp-live',
		'>   - **阶段成果：** 可见',
		'',
		'后续内容',
	].join('\n');
	assert.equal(checkpointEntryAroundLine(content, 2)?.blockId, 'cp-live');
	assert.equal(checkpointEntryAroundLine(content, 4)?.values.checkpoint_summary, '完成');
	assert.equal(checkpointEntryAroundLine(content, 6), undefined);
});

void test('filters checkpoint entries by daily note date', () => {
	const content = [
		'> [!thread-checkpoint] milestone · 09-01 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-01] [checkpoint_summary:: 今天] ^cp-today',
		'',
		'> [!thread-checkpoint] milestone · 08-31 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_summary:: 昨天] ^cp-yesterday',
	].join('\n');
	assert.deepEqual(
		checkpointEntriesForDate(content, '2026-09-01').map((entry) => entry.blockId),
		['cp-today'],
	);
});

void test('appends checkpoint callouts to the workspace', () => {
	const entry = [
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] ^cp-new',
	].join('\n');
	const original = [
		'# Thread 工作区',
		'',
		'自由记录',
		'',
	].join('\n');
	const result = appendCheckpointEntry(original, entry);
	assert.match(result, /自由记录\n\n> \[!thread-checkpoint\].*\n> - \[checkpoint:: true\]/);
	assert.ok(result.indexOf('自由记录') < result.indexOf('^cp-new'));
});

void test('inserts checkpoint callouts at a workspace cursor line', () => {
	const original = [
		'# Thread 工作区',
		'',
		'第一段',
		'',
		'第二段',
	].join('\n');
	const result = insertCheckpointEntryAtLine(
		original,
		[
			'> [!thread-checkpoint] review · 09-01 10:30',
			'> - [checkpoint:: true] [checkpoint_date:: 2026-09-01] ^cp-custom',
		].join('\n'),
		2,
	);
	assert.match(result, /第一段\n\n> \[!thread-checkpoint\][\s\S]*\^cp-custom\n\n第二段/);
});

void test('replaces one checkpoint in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-checkpoint] milestone · 09-01 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-01] [checkpoint_summary:: 旧摘要] ^cp-edit',
		'>   - **详情：** 旧内容',
		'',
		'> [!thread-checkpoint] milestone · 08-31 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_summary:: 保留] ^cp-keep',
	].join('\n');
	const replacement = [
		'> [!thread-checkpoint] review · 09-02 10:30',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-02] [checkpoint_time:: 10:30] [checkpoint_summary:: 新摘要] ^cp-edit',
		'>   - **详情：** 新内容',
	].join('\n');
	const result = replaceCheckpointEntry(original, 'cp-edit', replacement);
	assert.match(result, /> \[!thread-checkpoint\] review · 09-02 10:30/);
	assert.match(result, /> - \[checkpoint:: true\].*新摘要.*\^cp-edit/);
	assert.match(result, /> {3}- \*\*详情：\*\* 新内容/);
	assert.doesNotMatch(result, /旧摘要|旧内容/);
	assert.match(result, /保留.*\^cp-keep/);
	assert.equal(parseCheckpointEntries(result).length, 2);
});

void test('adds active template fields when editing an older checkpoint', () => {
	const fields = normalizeCheckpointFields([
		{
			key: 'checkpoint_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
		{
			key: 'new_note', label: '新增说明', control: 'textarea', storage: 'body',
			required: false,
		},
		{
			key: 'retired', label: '旧字段', control: 'text', storage: 'inline',
			deprecated: true,
		},
	]);
	const edit = checkpointEditState(fields, {
		blockId: 'cp-old',
		values: {
			checkpoint: 'true',
			checkpoint_date: '2026-09-01',
			checkpoint_summary: '旧记录',
			legacy_only: '保留',
		},
		body: [],
	});
	assert.deepEqual(edit.fields.map((field) => field.key), [
		'checkpoint_summary', 'new_note', 'legacy_only',
	]);
	assert.equal(edit.values.new_note, undefined);
	assert.equal(edit.fields.find((field) => field.key === 'new_note')?.required, false);
	assert.equal(edit.fields.find((field) => field.key === 'legacy_only')?.deprecated, true);
});

void test('deletes one checkpoint in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-checkpoint] review · 09-02 10:30',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-02] [checkpoint_summary:: 删除] ^cp-delete',
		'>   - **详情：** 一并删除',
		'',
		'> [!thread-checkpoint] milestone · 09-01 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-01] [checkpoint_summary:: 保留] ^cp-keep',
	].join('\n');
	const result = deleteCheckpointEntry(original, 'cp-delete');
	assert.doesNotMatch(result, /删除|一并删除|cp-delete/);
	assert.match(result, /保留.*\^cp-keep/);
	assert.equal(parseCheckpointEntries(result).length, 1);
});

void test('supports only the five current status values', () => {
	assert.deepEqual(
		THREAD_STATUS_CHOICES.map((choice) => choice.value),
		['active', 'paused', 'review', 'completed', 'closed'],
	);
	assert.equal(threadStatusLabel('active'), '行动中');
});

void test('resolves current wikilinks and aliases', () => {
	assert.equal(stripWikiLink('[[260831·睡眠管理#Context|睡眠管理]]'), '260831·睡眠管理');
	assert.equal(wikiLinkAlias('[[260831·睡眠管理|睡眠管理]]'), '睡眠管理');
	assert.equal(wikiLinkAlias('[[260831·睡眠管理]]'), undefined);
});
