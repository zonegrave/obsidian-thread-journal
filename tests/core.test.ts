import { migrateTaskSchedule } from '../scripts/task-schedule-migration';
import { migrateTaskStates } from '../scripts/task-state-migration';
import { EMPTY_TASK, completeTaskData, releaseTaskHolding, taskStatusMarker } from '../src/task-model';
import { boardTaskLane, compareBoardTasks, groupBoardTasks, taskIsActiveOnBoard, taskLineWithBoardStatus } from '../src/thread-task-board-model';
import { dependencyReference, holdingGraphError, holdingResult, scanTaskLines } from '../src/task-holding-model';
import {
	attentionHint,
	filterAttentionTasks,
	selectAttentionFallbackPaths,
	summarizeAttention,
	taskIsPinned,
	taskLineWithPin,
	taskTextWithoutPin,
	todoDisposition,
	threadUsesAttentionFallback,
} from '../src/thread-attention-model';
import {
	breadcrumbMenuSide,
	breadcrumbRightClearance,
	breadcrumbTooltipPlacement,
	filterBreadcrumbThreads,
	rootedBreadcrumbTrail,
} from '../src/thread-breadcrumb-model';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocale, setLocale, translate } from '../src/i18n';
import {
	appendCommitEntry,
	buildCommitEntry,
	commitEditState,
	commitEntryAroundLine,
	commitInsertionEdit,
	cursorLineIsFrontmatter,
	deleteCommitEntry,
	insertCommitAfterTask,
	parseCommitEntries,
	replaceCommitEntry,
} from '../src/commit-core';
import {
	activeCommitFields,
	commitBodyLabels,
	commitFieldRenderMode,
	commitFieldsForThread,
	DEFAULT_COMMIT_FIELDS,
	normalizeCommitFields,
} from '../src/commit-model';
import { moveCommitOption } from '../src/commit-option-model';
import {
	buildThreadFileName,
	stripWikiLink,
	wikiLinkAlias,
} from '../src/core';
import {
	DEFAULT_THREAD_ROLE_TEMPLATE,
	renderThreadFileTemplate,
} from '../src/thread-template';
import { ThreadIndex } from '../src/thread-index';
import { RootThreadManager } from '../src/thread-root';
import { tableRootTrail } from '../src/thread-table-breadcrumb-model';
import { filterThreadTable, DEFAULT_TABLE_FILTERS, tableFiltersFromState } from '../src/thread-table-filter-model';
import { totalThreadTable, uniqueTableTasks } from '../src/thread-table-total-model';
import { collectThreadTable, type ThreadTableRow } from '../src/thread-table-data';
import { countTableTask, emptyThreadTableCounts, flattenThreadTableTree, tableTaskMatches, threadTableContent } from '../src/thread-table-model';
import { ROOT_THREAD_ID, rootThreadContent, rootThreadPath, rootThreadSettingsValid } from '../src/thread-root-model';
import {
	buildInlineLogEdit,
	inlineLogEntryAroundLine,
	parseInlineLogEntrySlots,
	parseInlineLogEntries,
} from '../src/inline-log';
import {
	compareThreadEntryTimestamps,
	formatThreadEntryTimestamp,
	parseThreadEntriesQuery,
} from '../src/entry-query';
import {
	THREAD_STATUS_CHOICES,
	THREAD_CREATION_STATUS_CHOICES,
	isThreadStatus,
	isOperationalThreadStatus,
	threadStatusLabel,
	threadStatusOptionLabel,
} from '../src/thread-status-model';
import {
	availableThreadParentIds,
	wouldCreateThreadParentCycle,
} from '../src/thread-parent-model';
import { replaceThreadDisplayAlias } from '../src/thread-meta-model';
import {
	buildThreadOverviewTree,
	buildRootedThreadOverviewTree,
	countThreadOverviewDescendants,
	DEFAULT_THREAD_OVERVIEW_STATUSES,
	filterThreadOverviewTree,
} from '../src/thread-overview-model';
import {
	clampMapZoom,
	fitMapZoom,
	mapPointAtViewportPosition,
	mapScrollForCenter,
	mapScrollForViewportPoint,
	mapStageGeometry,
	mapViewportCenter,
	wheelMapZoomFactor,
} from '../src/thread-overview-layout';
import {
	nextActiveThreadRolePath,
} from '../src/thread-switcher-model';
import {
	advanceTaskData,
	advanceTaskLine,
	buildTaskLine,
	createTaskId,
	parseTaskLine,
	taskScheduledLabel,
	taskDraftFromTextLine,
	taskValidationError,
	taskWindowLabel,
	taskWindowState,
	type TaskData,
} from '../src/task-model';
import { parseTaskReference } from '../src/task-reference-model';
import { is24HourTime } from '../src/time-input';

void test('board puts deadlines first and retains default ordering for remaining tasks', () => {
	const item = (text: string, dates: Partial<TaskData> = {}, title = '') => ({
		task: { text, data: { ...EMPTY_TASK, ...dates } }, thread: { title },
	});
	const tasks = [
		item('Undated Z'),
		item('Early start', { windowStart: '2026-01-01' }),
		item('Later deadline', { windowEnd: '2026-10-20' }),
		item('Current', { scheduled: '2026-10-10' }),
		item('Today deadline', { windowEnd: '2026-10-14' }),
		item('Undated A'),
		item('Overdue', { windowEnd: '2026-10-12' }),
	];
	assert.deepEqual(tasks.sort(compareBoardTasks).map(({ task }) => task.text), [
		'Overdue', 'Today deadline', 'Later deadline', 'Early start', 'Current', 'Undated A', 'Undated Z',
	]);
	assert.ok(compareBoardTasks(item('A', { windowEnd: '2026-10-14' }), item('B', { windowEnd: '2026-10-14' })) < 0);
	assert.ok(compareBoardTasks(item('A', {}, 'A'), item('A', {}, 'B')) < 0);
});

void test('due holding reviews precede actionable deadlines and held deadlines remain in holding', () => {
	const item = (text: string, data: Partial<TaskData>) => ({
		task: { text, data: { ...EMPTY_TASK, ...data } }, thread: { title: '' },
	});
	const tasks = [
		item('Future deadline', { windowEnd: '2026-11-19' }),
		item('Ordinary', {}),
		item('Held overdue', { holding: true, windowEnd: '2026-10-01', holdingReview: '2026-10-20' }),
		item('Review today', { holding: true, holdingReview: '2026-10-19' }),
		item('Overdue actionable', { windowEnd: '2026-10-18' }),
		item('Review with deadline', { holding: true, holdingReview: '2026-10-18', windowEnd: '2026-10-21' }),
		item('Held without review', { holding: true, windowEnd: '2026-10-19' }),
	];
	const before = JSON.stringify(tasks);
	const grouped = groupBoardTasks(tasks, '2026-10-19');
	assert.deepEqual(grouped.review.map(item => item.task.text), ['Review with deadline', 'Review today']);
	assert.deepEqual(grouped.current.map(item => item.task.text), ['Overdue actionable', 'Future deadline', 'Ordinary']);
	assert.deepEqual(grouped.holding.map(item => item.task.text), ['Held overdue', 'Held without review']);
	assert.equal(JSON.stringify(tasks), before);
	assert.deepEqual(groupBoardTasks([], '2026-10-19'), { review: [], current: [], holding: [] });
});

void test('moving a board task changes only its state marker and preserves metadata exactly', () => {
	const body = '重复任务 [task_id:: task-123456789abc] [thread_pin:: true] [holding:: true] [holding_for:: task-abcdefghijkl] [window_start:: 2026-10-14] [repeat:: daily] [scheduled:: 2026-10-14] [effort:: light] [custom:: value] ^task-block';
	for (const from of ['open', 'committed', 'idea'] as const) {
		const line = `  > - [${taskStatusMarker(from)}] ${body}  `;
		for (const to of ['open', 'committed', 'idea'] as const) {
			assert.equal(taskLineWithBoardStatus(line, to), `  > - [${taskStatusMarker(to)}] ${body}  `);
		}
	}
	assert.equal(taskLineWithBoardStatus('- [x] finished', 'open'), undefined);
	assert.equal(taskLineWithBoardStatus('- [-] cancelled', 'open'), undefined);
	assert.equal(taskLineWithBoardStatus('ordinary text', 'idea'), undefined);
});

void test('task board shows tasks whose start has arrived, including overdue tasks', () => {
	const today = '2026-10-14';
	for (const status of ['open', 'committed', 'idea'] as const) {
		const data = { ...EMPTY_TASK, status };
		assert.equal(taskIsActiveOnBoard(data, today), true);
		assert.equal(taskIsActiveOnBoard({ ...data, windowStart: '2026-10-15' }, today), false);
		assert.equal(taskIsActiveOnBoard({ ...data, windowStart: today }, today), true);
		assert.equal(taskIsActiveOnBoard({ ...data, windowStart: '2026-10-13' }, today), true);
		assert.equal(taskIsActiveOnBoard({ ...data, windowEnd: '2026-10-13' }, today), true);
		assert.equal(taskIsActiveOnBoard({ ...data, windowEnd: today }, today), true);
	}
	for (const status of ['completed', 'cancelled'] as const) {
		assert.equal(taskIsActiveOnBoard({ ...EMPTY_TASK, status }, today), false);
	}
});

void test('scheduled tasks leave decision queues and include single and repeating overdue work', () => {
	const today = '2026-10-21';
	for (const repeat of [false, true]) {
		const base = { ...EMPTY_TASK, repeat };
		assert.equal(boardTaskLane({ ...base, scheduled: today }, today), 'scheduled');
		assert.equal(boardTaskLane({ ...base, scheduled: '2026-10-20' }, today), 'scheduled');
		assert.equal(boardTaskLane({ ...base, scheduled: '2026-10-22' }, today), undefined);
		assert.equal(boardTaskLane({ ...base, scheduled: today, windowStart: '2026-10-22' }, today), 'scheduled');
		assert.equal(boardTaskLane({ ...base, scheduled: today, status: 'completed' }, today), undefined);
	}
	assert.equal(boardTaskLane(EMPTY_TASK, today), 'decision');
	assert.equal(boardTaskLane({ ...EMPTY_TASK, pinned: true }, today), 'pinned');
	assert.equal(boardTaskLane({ ...EMPTY_TASK, pinned: true, windowStart: '2026-11-01' }, today), 'pinned');
	for (const status of ['idea', 'committed'] as const) {
		const task = { ...EMPTY_TASK, pinned: true, status };
		assert.equal(boardTaskLane(task, today), 'decision');
		const counts = emptyThreadTableCounts();
		countTableTask(counts, task, today);
		assert.equal(counts.pinned, 0);
		assert.equal(tableTaskMatches(task, 'pinned', false, today), false);
	}
});

void test('a single scheduled date round-trips; scheduling and pinning are mutually exclusive', () => {
	const source = '- [ ] 准备材料 [task_id:: task-123456789abc] [scheduled:: 2026-10-21] [thread_pin:: true]';
	const parsed = parseTaskLine(source)!;
	assert.equal(parsed.data.scheduled, '2026-10-21');
	assert.equal(parsed.data.repeat, false);
	assert.equal(parsed.data.pinned, false);
	assert.match(buildTaskLine(parsed.data, parsed), /\[scheduled:: 2026-10-21\]/u);
	assert.doesNotMatch(buildTaskLine(parsed.data, parsed), /thread_pin|repeat::/u);
	assert.throws(() => taskLineWithPin(source, true));
	const cleared = { ...parsed.data, scheduled: '', repeat: false };
	assert.doesNotMatch(buildTaskLine(cleared, parsed), /scheduled::/u);
	assert.equal(boardTaskLane(cleared, '2026-10-21'), 'decision');
	assert.equal(completeTaskData(parsed.data).status, 'completed');
});

void test('one-time schedule migration preserves source, task references, fences and occurrence identities', () => {
	const source = [
		'- [ ] 记录 [current:: 2026-10-21] [repeat:: FREQ=WEEKLY;INTERVAL=2] [thread_pin:: true] ^task-a',
		'- [ ] 后续 [holding_for:: task-123456789abc@2026-10-21]',
		'```md', '- [ ] 示例 [current:: 2026-10-21]', '```',
	].join('\n');
	const result = migrateTaskSchedule(source);
	assert.deepEqual(result.changedLines, [1]);
	assert.match(result.content, /记录 \[scheduled:: 2026-10-21\] \[repeat:: FREQ=WEEKLY;INTERVAL=2\] \^task-a/u);
	assert.match(result.content, /holding_for:: task-123456789abc@2026-10-21/u);
	assert.match(result.content, /示例 \[current:: 2026-10-21\]/u);
	assert.equal(migrateTaskSchedule(result.content).content, result.content);
	assert.throws(() => migrateTaskSchedule('- [ ] 冲突 [current:: 2026-10-20] [scheduled:: 2026-10-21]'));
});

void test('resolves automatic language and translates interpolated UI text', () => {
	assert.equal(resolveLocale('auto', 'zh-CN'), 'zh');
	assert.equal(resolveLocale('auto', 'en-US'), 'en');
	assert.equal(resolveLocale('zh', 'en-US'), 'zh');
	assert.equal(translate('en', 'Created {title}', { title: 'Project' }), 'Created Project');
	assert.equal(translate('zh', 'Created {title}', { title: '项目' }), '已创建 项目');
});

void test('overview canvas can center content edges at every zoom level', () => {
	for (const zoom of [0.2, 1, 2]) {
		const stage = mapStageGeometry(1200, 800, 600, 400, zoom);
		const maxScrollLeft = stage.width - 600;
		const maxScrollTop = stage.height - 400;
		assert.equal(stage.left, 300);
		assert.equal(stage.top, 200);
		assert.equal(stage.left + 1200 * zoom - maxScrollLeft, 300);
		assert.equal(stage.top + 800 * zoom - maxScrollTop, 200);
	}
	assert.equal(clampMapZoom(0), 0.05);
	assert.equal(clampMapZoom(10), 2.5);
	assert.equal(fitMapZoom(1200, 800, 600, 400), 0.44);
});

void test('overview restores the same map viewpoint after a tab resize or redraw', () => {
	const before = mapStageGeometry(1200, 800, 600, 400, 1.5);
	const center = mapViewportCenter(450, 125, 600, 400, before.left, before.top, 1.5);
	assert.deepEqual(center, { x: 300, y: 125 / 1.5 });
	const after = mapStageGeometry(1200, 800, 800, 500, 1.5);
	const restored = mapScrollForCenter(center, 800, 500, after.left, after.top, 1.5);
	assert.deepEqual(restored, { left: 450, top: 125 });
	assert.deepEqual(
		mapViewportCenter(restored.left, restored.top, 800, 500, after.left, after.top, 1.5),
		center,
	);
});

void test('overview pinch zoom keeps the point under the gesture stationary', () => {
	const anchor = { x: 100, y: 80 };
	const before = mapStageGeometry(1200, 800, 600, 400, 1);
	const point = mapPointAtViewportPosition(
		250, 150, anchor.x, anchor.y, before.left, before.top, 1,
	);
	assert.deepEqual(point, { x: 50, y: 30 });
	const after = mapStageGeometry(1200, 800, 600, 400, 2);
	const offset = mapScrollForViewportPoint(
		point, anchor.x, anchor.y, after.left, after.top, 2,
	);
	assert.deepEqual(offset, { left: 300, top: 180 });
	assert.deepEqual(
		mapPointAtViewportPosition(
			offset.left, offset.top, anchor.x, anchor.y, after.left, after.top, 2,
		),
		point,
	);
	assert.equal(wheelMapZoomFactor(-20, 0, 400) > 1, true);
	assert.equal(wheelMapZoomFactor(20, 0, 400) < 1, true);
	assert.equal(wheelMapZoomFactor(-1000, 0, 400), 1.25);
	assert.equal(wheelMapZoomFactor(1000, 0, 400), 0.75);
});

void test('builds safe thread member file names', () => {
	assert.equal(buildThreadFileName('睡眠/管理'), '睡眠-管理');
	assert.equal(
		buildThreadFileName('睡眠/管理', '3e9b3f36-7f7d-4205-97b0-82c533155eb0'),
		'睡眠-管理·3e9b3f36',
	);
	assert.equal(buildThreadFileName('...'), '');
});

void test('builds a queryable inline log callout at the cursor line', () => {
	assert.deepEqual(
		buildInlineLogEdit(
			'  ',
			2,
			'2026-09-04T14:35:27',
			'log-20260904-143527-a1b2c',
		),
		{
			replacement: [
				'  > [!thread-log]',
				'  > - (thread_log:: 2026-09-04T14:35:27)  ^log-20260904-143527-a1b2c',
			].join('\n') + '\n',
			fromCh: 0,
			toCh: 2,
			cursorLineOffset: 1,
			cursorCh: '  > - (thread_log:: 2026-09-04T14:35:27) '.length,
		},
	);
	assert.deepEqual(
		buildInlineLogEdit(
			'已有内容',
			4,
			'2026-09-04T14:35:27',
			'log-20260904-143527-a1b2c',
		),
		{
			replacement: [
				'',
				'',
				'> [!thread-log]',
				'> - (thread_log:: 2026-09-04T14:35:27)  ^log-20260904-143527-a1b2c',
			].join('\n') + '\n',
			fromCh: 4,
			toCh: 4,
			cursorLineOffset: 3,
			cursorCh: '> - (thread_log:: 2026-09-04T14:35:27) '.length,
		},
	);
	const middle = buildInlineLogEdit(
		'已有内容',
		2,
		'2026-09-04T14:35:27',
		'log-middle',
	);
	assert.equal(middle.fromCh, 2);
	assert.equal(middle.toCh, 2);
	assert.equal(middle.cursorLineOffset, 3);
	assert.match(middle.replacement, /\n\n> \[!thread-log\]/u);
	assert.match(middle.replacement, /\(thread_log:: 2026-09-04T14:35:27\) {2}\^log-middle\n\n$/u);
	const splitLine = '已有内容'.slice(0, 2) + middle.replacement + '已有内容'.slice(2);
	assert.match(splitLine, /^已有\n\n> \[!thread-log\][\s\S]*\^log-middle\n\n内容$/u);
	const compactLines = middle.replacement.trim().split('\n');
	const logLine = compactLines[1] ?? '';
	const typed = logLine.slice(0, middle.cursorCh)
		+ '完成接口验证'
		+ logLine.slice(middle.cursorCh);
	assert.equal(
		parseInlineLogEntries([compactLines[0], typed].join('\n'))[0]?.text,
		'完成接口验证',
	);
});

void test('parses multiline inline logs for a daily summary', () => {
	const content = [
		'> [!thread-log] 任意标题内容',
		'> (thread_log:: 2026-09-04T14:35:27)',
		'> ',
		'> 完成了 [[接口验证]]',
		'> 第二行也应显示',
		'> ',
		'> - 继续调研',
		'',
		'^log-20260904-143527-a1b2c',
		'',
		'> [!thread-log]',
		'> (thread_log:: 2026-09-03T23:10:00)',
		'> ',
		'> 昨天的记录',
		'',
		'^log-20260903-231000-d4e5f',
		'',
		'> [!thread-log]',
		'> (thread_log:: not-a-time)',
		'> 不应进入结果',
		'普通文本 (thread_log:: 2026-09-04T12:00:00)',
	].join('\n');

	assert.deepEqual(parseInlineLogEntries(content), [
		{
			timestamp: '2026-09-04T14:35:27',
			date: '2026-09-04',
			time: '14:35',
			text: '完成了 [[接口验证]]\n第二行也应显示\n\n- 继续调研',
			blockId: 'log-20260904-143527-a1b2c',
		},
		{
			timestamp: '2026-09-03T23:10:00',
			date: '2026-09-03',
			time: '23:10',
			text: '昨天的记录',
			blockId: 'log-20260903-231000-d4e5f',
		},
	]);
});

void test('reads existing thread-log callouts and keeps malformed slots aligned', () => {
	const content = [
		'> [!thread-log] 09-03 23:10',
		'> - (thread_log:: 2026-09-03T23:10:00) 旧记录 ^log-old',
		'> 旧记录续行',
		'> [!thread-log]',
		'> (thread_log:: 2026-09-04T14:35:27)',
		'> ',
		'> 新记录',
		'',
		'^log-new',
		'',
		'> [!thread-log] 缺少时间数据',
		'> 只有正文',
		'> 不应进入结果',
		'> [!thread-log]+ 可折叠标题',
		'> (thread_log:: 2026-09-04T16:00:00)',
		'> 没有 ID 仍可查询',
	].join('\n');
	const slots = parseInlineLogEntrySlots(content);
	assert.equal(slots.length, 4);
	assert.equal(slots[0]?.text, '旧记录\n旧记录续行');
	assert.equal(slots[0]?.blockId, 'log-old');
	assert.equal(slots[1]?.text, '新记录');
	assert.equal(slots[2], undefined);
	assert.equal(slots[3]?.text, '没有 ID 仍可查询');
	assert.equal(slots[3]?.blockId, '');
	assert.deepEqual(parseInlineLogEntries(content), [slots[0], slots[1], slots[3]]);
});

void test('preserves internal Markdown block IDs inside a log body', () => {
	const content = [
		'> [!thread-log]',
		'> (thread_log:: 2026-09-04T16:00:00)',
		'> ',
		'> 这一段有自己的定位 ^sub-block',
		'> - Markdown 列表 ^list-item',
		'',
		'^log-parent',
		'',
	].join('\n');
	assert.equal(
		parseInlineLogEntries(content)[0]?.text,
		'这一段有自己的定位 ^sub-block\n- Markdown 列表 ^list-item',
	);
});

void test('finds the inline log around a Live Preview source line', () => {
	const content = [
		'# 工作区',
		'',
		'> [!thread-log] 09-04 14:35',
		'> (thread_log:: 2026-09-04T14:35:27)',
		'> ',
		'> 完成了 [[接口验证]]',
		'> 第二行',
		'',
		'^log-20260904-143527-a1b2c',
		'',
		'后续内容',
	].join('\n');

	assert.deepEqual(inlineLogEntryAroundLine(content, 2), {
		timestamp: '2026-09-04T14:35:27',
		date: '2026-09-04',
		time: '14:35',
		text: '完成了 [[接口验证]]\n第二行',
		blockId: 'log-20260904-143527-a1b2c',
	});
	assert.equal(inlineLogEntryAroundLine(content, 6)?.text, '完成了 [[接口验证]]\n第二行');
	assert.equal(inlineLogEntryAroundLine(content, 10), undefined);
});

void test('parses the unified thread entries query', () => {
	assert.deepEqual(parseThreadEntriesQuery([
		'thread_id: 20e15ed8-5de0-44bc-919f-54d49294c14c',
		'date: 2026-09-01..2026-09-04',
		'type: [commit, log]',
		'group_by: thread',
		'thread_detail: crumb',
		'order: asc',
	].join('\n')), {
		query: {
			threadIds: ['20e15ed8-5de0-44bc-919f-54d49294c14c'],
			date: { from: '2026-09-01', to: '2026-09-04' },
			types: ['commit', 'log'],
			groupBy: 'thread',
			threadDetail: 'crumb',
			order: 'asc',
		},
		errors: [],
	});
	assert.deepEqual(parseThreadEntriesQuery(''), {
		query: {
			threadIds: undefined,
			date: undefined,
			types: ['commit', 'log'],
			groupBy: 'none',
			threadDetail: 'none',
			order: 'desc',
		},
		errors: [],
	});
	assert.deepEqual(parseThreadEntriesQuery('date: 2026-09-04').query.date, {
		from: '2026-09-04',
		to: '2026-09-04',
	});
	assert.equal(parseThreadEntriesQuery('date: 2026-09-04').query.order, 'desc');
});

void test('reports invalid thread entries query values', () => {
	const result = parseThreadEntriesQuery([
		'date: 2026-09-05..2026-09-01',
		'type: commit, thought',
		'group_by: day',
		'thread_detail: full',
		'order: newest',
		'unknown: value',
	].join('\n'));
	assert.equal(result.errors.length, 6);
	assert.match(result.errors.join('\n'), /date/);
	assert.match(result.errors.join('\n'), /thought/);
	assert.match(result.errors.join('\n'), /group_by/);
	assert.match(result.errors.join('\n'), /thread_detail/);
	assert.match(result.errors.join('\n'), /order/);
	assert.match(result.errors.join('\n'), /unknown/);
});

void test('formats commit and log timestamps consistently', () => {
	assert.equal(formatThreadEntryTimestamp('2026-09-05', '07:20'), '26/09/05 07:20');
	assert.equal(formatThreadEntryTimestamp('2026-09-05', '07:20', true), '07:20');
	assert.equal(formatThreadEntryTimestamp('2026-09-05', '', true), '26/09/05');
	assert.equal(formatThreadEntryTimestamp('未填写日期', ''), '未填写日期');
});

void test('sorts thread entry timestamps only by the explicit order', () => {
	const earlier = '2026-09-04T09:00:00';
	const later = '2026-09-04T10:00:00';
	assert.ok(compareThreadEntryTimestamps(earlier, later, 'asc') < 0);
	assert.ok(compareThreadEntryTimestamps(earlier, later, 'desc') > 0);
});

void test('groups arbitrary member files under meta and resolves its unique entry', () => {
	const threadFile = { path: '50-行动系统/Thread Meta/thread-1.md', basename: 'thread-1' };
	const entry = { path: '50-行动系统/Thread Files/睡眠管理.md', basename: '睡眠管理' };
	const research = { path: '50-行动系统/Thread Files/睡眠研究.md', basename: '睡眠研究' };
	const other = { path: '50-行动系统/Thread Files/其它.md', basename: '其它' };
	const frontmatter = new Map<unknown, Record<string, unknown>>([
		[threadFile, {
			type: 'thread', thread_id: 'thread-1', aliases: ['已改名 thread'],
			entry: '[[睡眠管理|入口]]',
		}],
		[entry, { thread_id: 'thread-1', attention_fallback: true }],
		[research, {
			type: 'source',
			thread_id: 'thread-1',
			thread_role: 'research',
			thread_icon: 'search',
			thread_role_status: 'terminated',
		}],
		[other, { thread_id: 'another-thread', thread_role: 'workspace' }],
	]);
	const app = {
		vault: {
			getMarkdownFiles: () => [threadFile, entry, research, other],
		},
		metadataCache: {
			getFileCache: (file: unknown) => ({ frontmatter: frontmatter.get(file) }),
			getFirstLinkpathDest: (link: string) => {
				if (link === '睡眠管理') return entry;
				if (link === '睡眠研究') return research;
				return null;
			},
		},
	};
	const index = new ThreadIndex(app as never);
	assert.equal(index.getEntry(threadFile as never), entry);
	assert.equal(index.getThreadForMember(research as never), threadFile);
	assert.equal(index.getMember(entry as never)?.role, 'workspace');
	assert.equal(index.getMember(entry as never)?.roleStatus, 'active');
	assert.equal(index.getMember(entry as never)?.attentionFallback, true);
	assert.equal(index.getMember(research as never)?.role, 'research');
	assert.equal(index.getMember(research as never)?.icon, 'search');
	assert.equal(index.getMember(research as never)?.roleStatus, 'terminated');
	assert.equal(index.getMember(research as never)?.attentionFallback, false);
	assert.deepEqual(index.getMembersByThreadId('thread-1').map((item) => item.file), [research, entry]);
	assert.equal(index.isEntry(entry as never), true);
	assert.equal(index.isEntry(research as never), false);
	assert.equal(index.getThread(threadFile as never)?.title, '已改名 thread');
	const threadMetadata = frontmatter.get(threadFile);
	if (threadMetadata) threadMetadata.entry = '[[睡眠研究]]';
	assert.equal(index.getEntry(threadFile as never), undefined);
});

void test('overview uses ROOT as the system root without duplicating or changing stored parents', () => {
	const items = [
		{ id: 'ROOT', title: 'ROOT', status: 'active' },
		{ id: 'a', title: 'A', status: 'active' },
		{ id: 'b', title: 'B', status: 'dormant', parent: 'ROOT' },
		{ id: 'c', title: 'C', status: 'active', parent: 'a' },
	];
	const before = JSON.stringify(items);
	const tree = buildRootedThreadOverviewTree(items, new Set(['active', 'dormant']));
	assert.deepEqual(tree.map(node => node.item.id), ['ROOT']);
	assert.deepEqual(tree[0]?.children.map(node => node.item.id), ['a', 'b']);
	assert.deepEqual(tree[0]?.children[0]?.children.map(node => node.item.id), ['c']);
	assert.equal(JSON.stringify(items), before);
	const dormant = buildRootedThreadOverviewTree(items, new Set(['dormant']));
	assert.equal(dormant[0]?.contextOnly, false);
	assert.deepEqual(dormant[0]?.children.map(node => node.item.id), ['b']);
	const none = buildRootedThreadOverviewTree(items, new Set());
	assert.equal(none[0]?.item.id, 'ROOT');
	assert.deepEqual(none[0]?.children, []);
	assert.equal(buildRootedThreadOverviewTree([items[0]!], new Set(['closed']))[0]?.item.id, 'ROOT');
});

void test('breadcrumb shows ROOT once and excludes it from ordinary thread switchers', () => {
	const root = { file: { path: 'Meta/ROOT.md' }, label: 'ROOT' };
	const current = { file: { path: 'Meta/a.md' }, label: 'A' };
	assert.deepEqual(rootedBreadcrumbTrail(root as never, [current as never]), [root, current]);
	assert.deepEqual(rootedBreadcrumbTrail(root as never, [root as never, current as never]), [root, current]);
	assert.deepEqual(rootedBreadcrumbTrail(root as never, [root as never]), [root]);
	const choices = [
		{ id: 'ROOT', title: 'ROOT', status: 'active' },
		{ id: 'a', title: 'A', status: 'active' },
	];
	assert.deepEqual(filterBreadcrumbThreads(choices as never).map(item => item.id), ['a']);
});

void test('table counts every action state and skips code samples and task references', () => {
	const source = [
		'---', 'sample: |', '  - [ ] YAML example', '---',
		'- [ ] open [holding:: true] [thread_pin:: true]',
		'- [+] committed', '- [!] idea', '- [x] completed', '- [-] cancelled',
		'- [/] recurring [repeat:: FREQ=DAILY] [scheduled:: 2026-10-20]',
		'- [ ] [reference_task_id:: task-123456789abc]',
		'```md', '- [ ] fenced task', '- [commit:: true]',
		'> [!thread-log]', '> - (thread_log:: 2026-10-20T09:00) fake', '```',
		'', 'Code example:', '', '    - [ ] indented task', '    - [commit:: true]',
		'> [!thread-commit]', '> - [commit:: true] [commit_date:: 2026-10-20] ^commit-a', '',
		'> [!thread-log]', '> - (thread_log:: 2026-10-20T09:00) actual ^log-a',
	].join('\n');
	const result = threadTableContent(source);
	const counts = emptyThreadTableCounts();
	for (const task of result.tasks) countTableTask(counts, task.parsed.data, '2026-10-20');
	assert.deepEqual({ ...counts, commits: result.commits, logs: result.logs }, {
		files: 0, children: 0, open: 2, committed: 1, idea: 1, completed: 1, cancelled: 1,
		holding: 1, scheduled: 1, pinned: 1, commits: 1, logs: 1,
	});
});

void test('table attention counts include single scheduled work and exclude future and completed schedules', () => {
	const counts = emptyThreadTableCounts();
	for (const data of [
		{ ...EMPTY_TASK, scheduled: '2026-10-20' },
		{ ...EMPTY_TASK, scheduled: '2026-10-21', repeat: true },
		{ ...EMPTY_TASK, scheduled: '2026-10-22' },
		{ ...EMPTY_TASK, scheduled: '2026-10-20', status: 'completed' as const },
		{ ...EMPTY_TASK, pinned: true },
	]) countTableTask(counts, data, '2026-10-21');
	assert.equal(counts.scheduled, 2);
	assert.equal(counts.pinned, 1);
	assert.equal(tableTaskMatches({ ...EMPTY_TASK, scheduled: '2026-10-20' }, 'scheduled', false, '2026-10-21'), true);
	assert.equal(tableTaskMatches({ ...EMPTY_TASK, scheduled: '2026-10-22' }, 'scheduled', false, '2026-10-21'), false);
});

void test('table collapse hides descendants without losing their hierarchy or sibling guides', () => {
	const tree = buildRootedThreadOverviewTree([
		{ id: 'ROOT', title: 'ROOT', status: 'active' },
		{ id: 'a', title: 'A', status: 'active' },
		{ id: 'b', title: 'B', status: 'active' },
		{ id: 'c', title: 'C', status: 'active', parent: 'a' },
	], new Set(['active']));
	const flat = flattenThreadTableTree(tree, new Set());
	assert.deepEqual(flat.map(row => [row.node.item.id, row.depth]), [['ROOT', 0], ['a', 1], ['c', 2], ['b', 1]]);
	assert.deepEqual(flat.find(row => row.node.item.id === 'c')?.guides, [true]);
	assert.equal(flat.find(row => row.node.item.id === 'b')?.last, true);
	assert.deepEqual(flattenThreadTableTree(tree, new Set(['a'])).map(row => row.node.item.id), ['ROOT', 'a', 'b']);
	assert.deepEqual(flattenThreadTableTree(tree, new Set(['ROOT'])).map(row => row.node.item.id), ['ROOT']);
	assert.equal(flattenThreadTableTree(tree, new Set()).length, 4);
});

void test('table totals stay with each owner including history; external links count once per owner', async () => {
	const file = (path: string) => ({ path, basename: path.replace(/^.*\//u, '').replace(/\.md$/u, '') });
	const root = file('Meta/ROOT.md');
	const parent = file('Meta/parent.md');
	const child = file('Meta/child.md');
	const essay = file('随笔.md');
	const work = file('工作.md');
	const history = file('历史.md');
	const childWork = file('子线程.md');
	const external = file('外部.md');
	const metadata = new Map<unknown, Record<string, unknown>>([
		[root, { type: 'thread', thread_id: 'ROOT', status: 'active' }],
		[parent, { type: 'thread', thread_id: 'parent', status: 'active' }],
		[child, { type: 'thread', thread_id: 'child', status: 'active', parent: '[[parent]]' }],
		[essay, { thread_id: 'ROOT' }], [work, { thread_id: 'parent' }],
		[history, { thread_id: 'parent', thread_role_status: 'terminated' }],
		[childWork, { thread_id: 'child' }],
	]);
	const contents = new Map<unknown, string>([
		[essay, '- [ ] essay'], [work, '- [ ] work\n> [!thread-commit]\n> - [commit:: true]'],
		[history, '- [x] finished\n- [-] cancelled'],
		[childWork, '- [ ] child work\n> [!thread-log]\n> - (thread_log:: 2026-10-20T09:00) child log'],
		[external, '- [+] external [[parent]] [[工作]]'],
	]);
	const app = {
		vault: { getMarkdownFiles: () => [root, parent, child, essay, work, history, childWork, external],
			cachedRead: (f: unknown) => Promise.resolve(contents.get(f) ?? '') },
		metadataCache: {
			getFileCache: (f: unknown) => ({ frontmatter: metadata.get(f),
				listItems: f === external ? [{ task: '+' }] : [],
				links: f === external ? ['parent', '工作'].map(link => ({ link, position: { start: { line: 0 } } })) : [] }),
			getFirstLinkpathDest: (link: string) => link === 'parent' ? parent : link === '工作' ? work : null,
		},
	};
	const rows = await collectThreadTable(app as never, new ThreadIndex(app as never, () => root.path), '2026-10-20');
	const totals = new Map(rows.map(row => [row.thread.id, row.counts]));
	assert.equal(totals.get('ROOT')?.children, 1);
	assert.equal(totals.get('ROOT')?.files, 1);
	assert.equal(totals.get('ROOT')?.open, 1);
	assert.equal(totals.get('parent')?.children, 1);
	assert.equal(totals.get('parent')?.files, 2);
	assert.equal(totals.get('parent')?.open, 1);
	assert.equal(totals.get('parent')?.committed, 1);
	assert.equal(totals.get('parent')?.completed, 1);
	assert.equal(totals.get('parent')?.cancelled, 1);
	assert.equal(totals.get('parent')?.commits, 1);
	assert.equal(totals.get('parent')?.logs, 0);
	assert.equal(totals.get('child')?.open, 1);
	assert.equal(totals.get('child')?.logs, 1);
	const parentRow = rows.find(row => row.thread.id === 'parent')!;
	assert.equal(parentRow.files.length, 2);
	assert.equal(parentRow.tasks.length, 4);
	const workRow = parentRow.files.find(file => file.member.file.path === work.path)!;
	assert.equal(workRow.counts.open, 1);
	assert.equal(workRow.counts.commits, 1);
	assert.equal(workRow.counts.committed, 0); // External links do not become member-file tasks.
	const historical = parentRow.files.find(file => file.member.file.path === history.path)!;
	assert.equal(historical.member.roleStatus, 'terminated');
	assert.equal(historical.counts.completed, 1);
	assert.equal(historical.counts.cancelled, 1);
	assert.equal(parentRow.tasks.filter(task => task.file.path === external.path).length, 1);
	assert.equal(parentRow.tasks.find(task => task.file.path === external.path)?.sourceLine, '- [+] external [[parent]] [[工作]]');
	assert.equal(rows.find(row => row.thread.id === 'child')?.files[0]?.counts.logs, 1);
});

void test('table task details hide ended tasks by default and honor explicit count filters', () => {
	const completed = { ...EMPTY_TASK, status: 'completed' as const, pinned: true, holding: true };
	assert.equal(tableTaskMatches(completed, 'all', false, '2026-10-20'), false);
	assert.equal(tableTaskMatches(completed, 'all', true, '2026-10-20'), true);
	assert.equal(tableTaskMatches(completed, 'completed', false, '2026-10-20'), true);
	assert.equal(tableTaskMatches(completed, 'cancelled', true, '2026-10-20'), false);
	assert.equal(tableTaskMatches(completed, 'pinned', false, '2026-10-20'), false);
	assert.equal(tableTaskMatches(completed, 'holding', false, '2026-10-20'), true);
	assert.equal(tableTaskMatches(EMPTY_TASK, 'open', false, '2026-10-20'), true);
	assert.equal(tableTaskMatches(EMPTY_TASK, 'committed', false, '2026-10-20'), false);
	assert.equal(tableTaskMatches(EMPTY_TASK, 'scheduled', true, '2026-10-20'), false);
});

function tableFixtureRow(id: string, parent?: string): ThreadTableRow {
	return { thread: { id, title: id, status: 'active', file: { path: `Meta/${id}.md`, basename: id } as never }, parent,
		counts: emptyThreadTableCounts(), files: [], tasks: [] };
}

void test('table filters intersect within the selected root and keep only necessary ancestors', () => {
	const root = tableFixtureRow('ROOT');
	const parent = tableFixtureRow('Alpha'); parent.thread.status = 'paused'; parent.counts.open = 2;
	const child = tableFixtureRow('Child', 'Alpha'); child.counts.completed = 7;
	child.files.push({ member: { file: { path: 'Needle.md', basename: 'Needle' } as never, threadId: 'Child', role: 'workspace', roleStatus: 'active', icon: '', attentionFallback: false }, counts: emptyThreadTableCounts() });
	const other = tableFixtureRow('Other'); other.counts.open = 3;
	const rows = [root, parent, child, other];
	const result = filterThreadTable(rows, { ...DEFAULT_TABLE_FILTERS, root: 'Alpha', query: 'needle', statuses: ['active'], tasks: 'without' });
	assert.deepEqual(result.matchedRows.map(row => row.thread.id), ['Child']);
	assert.deepEqual(flattenThreadTableTree(result.tree, new Set()).map(row => row.node.item.id), ['Alpha', 'Child']);
	assert.equal(result.tree[0]?.contextOnly, true);
	assert.deepEqual([...result.fileMatches.get('Child')!], ['Needle.md']);
	assert.equal(filterThreadTable(rows, { ...DEFAULT_TABLE_FILTERS, root: 'Other', query: 'needle' }).tree.length, 0);
	assert.equal(filterThreadTable(rows, { ...DEFAULT_TABLE_FILTERS, statuses: [] }).tree.length, 0);
	assert.equal(filterThreadTable(rows, { ...DEFAULT_TABLE_FILTERS, root: 'missing' }).tree.length, 0);
	const named = filterThreadTable(rows, { ...DEFAULT_TABLE_FILTERS, query: 'alpha' });
	assert.deepEqual(named.matchedRows.map(row => row.thread.id), ['Alpha']);
	assert.equal(named.fileMatches.size, 0);
	assert.deepEqual(filterThreadTable(rows, { ...DEFAULT_TABLE_FILTERS, tasks: 'range', min: 1, max: 2 }).matchedRows.map(row => row.thread.id), ['Alpha']);
	assert.deepEqual(tableFiltersFromState({ statuses: [], min: -1, max: 2.5, tasks: 'invalid' }), { ...DEFAULT_TABLE_FILTERS, statuses: [] });
});

void test('table root breadcrumb follows the canonical tree and exposes direct children', () => {
	const rows = [tableFixtureRow('ROOT'), tableFixtureRow('Alpha'), tableFixtureRow('Child', 'Alpha'), tableFixtureRow('Other')];
	const trail = tableRootTrail(rows, 'Child');
	assert.deepEqual(trail.map(crumb => crumb.id), ['', 'Alpha', 'Child']);
	assert.deepEqual(trail[0]?.children.map(child => child.id), ['Alpha', 'Other']);
	assert.deepEqual(trail[1]?.children.map(child => child.id), ['Child']);
	assert.equal(tableRootTrail(rows, '').length, 1);
	assert.equal(tableRootTrail(rows, 'ROOT').length, 1);
	assert.equal(tableRootTrail(rows, 'missing').length, 1);
});

void test('table totals ignore expansion and deduplicate physical tasks across matched threads', () => {
	const parent = tableFixtureRow('Parent'); const child = tableFixtureRow('Child', 'Parent');
	const shared = { key: 'External.md:0', file: { path: 'External.md', basename: 'External' } as never, line: 0,
		sourceLine: '- [ ] shared', text: 'shared', disposition: 'ready' as const, pinned: false, data: { ...EMPTY_TASK, scheduled: '2026-10-22' } };
	parent.tasks.push(shared); child.tasks.push(shared);
	child.tasks.push({ ...shared, key: 'Child.md:1', file: { path: 'Child.md', basename: 'Child' } as never, line: 1, data: { ...EMPTY_TASK, status: 'completed' } });
	parent.counts.commits = 2; child.counts.commits = 3; child.counts.logs = 4;
	const total = totalThreadTable([parent, child], '2026-10-22');
	assert.equal(total.open, 1); assert.equal(total.completed, 1); assert.equal(total.scheduled, 1);
	assert.equal(total.commits, 5); assert.equal(total.logs, 4); assert.equal(total.files, 0); assert.equal(total.children, 0);
	assert.equal(uniqueTableTasks([parent, child]).length, 2);
	assert.deepEqual(uniqueTableTasks([parent, child])[0]?.owners, ['Parent', 'Child']);
	assert.equal(totalThreadTable([child], '2026-10-22').commits, 3);
	assert.equal(totalThreadTable([parent, parent, child], '2026-10-22').commits, 5);
	assert.deepEqual(totalThreadTable([], '2026-10-22'), emptyThreadTableCounts());
});

void test('ROOT has one canonical meta, fixed identity, and ordinary member and entry resolution', () => {
	const root = { path: 'Meta/ROOT.md', basename: 'ROOT' };
	const duplicate = { path: 'Other/ROOT.md', basename: 'ROOT' };
	const entry = { path: '随笔.md', basename: '随笔' };
	const normal = { path: 'Meta/normal.md', basename: 'normal' };
	const frontmatter = new Map<unknown, Record<string, unknown>>([
		[root, { type: 'thread', thread_id: ROOT_THREAD_ID, aliases: ['wrong name'], status: 'closed', parent: '[[normal]]', entry: '[[随笔]]' }],
		[duplicate, { type: 'thread', thread_id: ROOT_THREAD_ID }],
		[entry, { thread_id: ROOT_THREAD_ID, thread_role: 'workspace' }],
		[normal, { type: 'thread', thread_id: 'uuid', status: 'active', aliases: ['Normal'] }],
	]);
	const index = new ThreadIndex({
		vault: { getMarkdownFiles: () => [duplicate, root, entry, normal] },
		metadataCache: {
			getFileCache: (file: unknown) => ({ frontmatter: frontmatter.get(file) }),
			getFirstLinkpathDest: (link: string) => link === '随笔' ? entry : normal,
		},
	} as never, () => 'Meta/ROOT.md');
	assert.equal(index.getThreadById(ROOT_THREAD_ID)?.file, root);
	assert.equal(index.getThread(duplicate as never), undefined);
	assert.equal(index.getThread(root as never)?.title, 'ROOT');
	assert.equal(index.getDisplayName(root as never), 'ROOT');
	assert.equal(index.getThread(root as never)?.status, 'active');
	assert.equal(index.getParent(root as never), undefined);
	assert.equal(index.getThreadForMember(entry as never), root);
	assert.equal(index.getEntry(root as never), entry);
	assert.equal(index.getParent(normal as never), undefined);
	assert.deepEqual(availableThreadParentIds([{ id: 'normal', status: 'active' }], ROOT_THREAD_ID), []);
	assert.equal(rootThreadSettingsValid('ROOT', 'active', ''), true);
	assert.equal(rootThreadSettingsValid('renamed', 'active', ''), false);
	assert.equal(rootThreadSettingsValid('ROOT', 'closed', ''), false);
	assert.equal(rootThreadSettingsValid('ROOT', 'active', 'normal'), false);
});

void test('ROOT initialization is single flight, preserves existing content, and refuses collisions', async () => {
	const files = new Map<string, { path: string; extension?: string; content?: string }>();
	const metadata = new Map<unknown, Record<string, unknown>>();
	let writes = 0;
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path),
			getMarkdownFiles: () => [...files.values()].filter(file => file.extension === 'md'),
			createFolder: (path: string) => { files.set(path, { path }); return Promise.resolve(); },
			create: (path: string, content: string) => {
				writes++;
				const file = { path, extension: 'md', content };
				files.set(path, file);
				metadata.set(file, { type: 'thread', thread_id: 'ROOT', entry: '[[随笔]]' });
				return Promise.resolve(file);
			},
		},
		metadataCache: { getFileCache: (file: unknown) => ({ frontmatter: metadata.get(file) }) },
	};
	const manager = new RootThreadManager(app as never, () => 'Meta');
	const [one, two] = await Promise.all([manager.ensure('2026-10-17'), manager.ensure('2026-10-17')]);
	assert.equal(one, two);
	assert.equal(writes, 1);
	assert.equal(files.get('Meta/ROOT.md')?.content, rootThreadContent('2026-10-17'));
	assert.equal(await manager.ensure('2026-10-18'), one);
	assert.equal(writes, 1);
	assert.equal(metadata.get(one)?.entry, '[[随笔]]');
	const moved = new RootThreadManager(app as never, () => 'Other');
	await assert.rejects(moved.ensure('2026-10-17'), /ROOT/);
	metadata.set(one, { type: 'source' });
	await assert.rejects(manager.ensure('2026-10-17'), /ROOT/);
	assert.equal(writes, 1);
	assert.equal(rootThreadPath('Meta/'), 'Meta/ROOT.md');
	assert.equal(rootThreadPath(''), 'ROOT.md');
});

void test('uses aliases then the filename as the thread display name', () => {
	const aliased = { path: '50-行动系统/同名项目·abc12345.md', basename: '同名项目·abc12345' };
	const plain = { path: '50-行动系统/普通项目.md', basename: '普通项目' };
	const frontmatter = new Map<unknown, Record<string, unknown>>([
		[aliased, {
			type: 'thread', thread_id: 'thread-a', aliases: ['同名项目'], title: '旧标题',
		}],
		[plain, { type: 'thread', thread_id: 'thread-b', title: '不再读取的旧标题' }],
	]);
	const app = {
		vault: { getMarkdownFiles: () => [aliased, plain] },
		metadataCache: {
			getFileCache: (file: unknown) => ({ frontmatter: frontmatter.get(file) }),
		},
	};
	const index = new ThreadIndex(app as never);
	assert.equal(index.getThread(aliased as never)?.title, '同名项目');
	assert.equal(index.getDisplayName(aliased as never), '同名项目');
	assert.equal(index.getThread(plain as never)?.title, '普通项目');
	assert.equal(index.getDisplayName(plain as never), '普通项目');
});

void test('updates only the primary thread display alias', () => {
	assert.deepEqual(
		replaceThreadDisplayAlias(['旧标题', '次要别名', '新标题'], ' 新标题 '),
		['新标题', '次要别名'],
	);
	assert.deepEqual(replaceThreadDisplayAlias('旧标题', '新标题'), ['新标题']);
	assert.deepEqual(replaceThreadDisplayAlias(undefined, '新标题'), ['新标题']);
});

void test('uses a minimal default role template', () => {
	assert.equal(
		DEFAULT_THREAD_ROLE_TEMPLATE,
		'---\nthread_role: workspace\nthread_icon: layout-dashboard\nthread_role_status: active\nattention_fallback: true\n---\n',
	);
});

void test('selects active attention fallbacks only when their file has no unfinished task', () => {
	const members = [
		{ path: 'workspace.md', roleStatus: 'active', attentionFallback: true },
		{ path: 'future-task.md', roleStatus: 'active', attentionFallback: true },
		{ path: 'context.md', roleStatus: 'active', attentionFallback: false },
		{ path: 'history.md', roleStatus: 'terminated', attentionFallback: true },
	];
	assert.deepEqual(
		selectAttentionFallbackPaths(members, new Set(['future-task.md'])),
		['workspace.md'],
	);
	assert.equal(threadUsesAttentionFallback('active'), true);
	assert.equal(threadUsesAttentionFallback('dormant'), false);
	assert.equal(threadUsesAttentionFallback('review'), false);
});

void test('renders thread member template placeholders', () => {
	const rendered = renderThreadFileTemplate([
		'# {{title}}',
		'{{status}} · {{filename}} · {{thread_id}} · {{thread_role}} · {{thread_role_status}}',
		'{{parent_title}} {{parent}}',
		'{{date}} / {{date:YYMMDD}}',
	].join('\n'), {
		title: '睡眠管理',
		fileName: '睡眠管理',
		threadId: 'stable-id',
		role: 'research',
		roleStatus: 'active',
		status: 'dormant',
		parentTitle: '健康管理',
		parentLink: '[[健康管理|健康管理]]',
		created: '2026-08-31',
	}, (format: string) => format === 'YYMMDD' ? '260831' : '2026-08-31');
	assert.match(rendered, /^# 睡眠管理/m);
	assert.match(rendered, /dormant · 睡眠管理 · stable-id · research · active/);
	assert.match(rendered, /2026-08-31 \/ 260831/);
});

void test('normalizes configurable commit fields and protects system keys', () => {
	assert.deepEqual(DEFAULT_COMMIT_FIELDS.map((field) => ({
		key: field.key,
		control: field.control,
		storage: field.storage,
	})), [
		{ key: 'commit_summary', control: 'textarea', storage: 'body' },
		{ key: 'effort', control: 'select', storage: 'inline' },
	]);
	assert.deepEqual(normalizeCommitFields([
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline', required: true,
		},
		{
			key: 'commit_time', label: '备注', control: 'textarea', storage: 'body', required: false,
		},
	]), [
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline',
			required: true, deprecated: false, options: [],
		},
		{
			key: 'commit_field_2', label: '备注', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		},
	]);
});

void test('recognizes body field labels independently of the current storage mode', () => {
	const labels = commitBodyLabels(normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
	]));
	assert.equal(labels.has('摘要'), true);
});

void test('moves commit select options without changing their values', () => {
	assert.deepEqual(
		moveCommitOption(['low', 'medium', 'high'], 0, 2),
		['medium', 'high', 'low'],
	);
	assert.deepEqual(
		moveCommitOption(['low', 'high'], 3, 0),
		['low', 'high'],
	);
});

void test('uses a per-thread commit template before the global default', () => {
	const defaults = normalizeCommitFields(undefined);
	assert.deepEqual(
		commitFieldsForThread(undefined, defaults).map((field) => field.key),
		['commit_summary', 'effort'],
	);
	assert.deepEqual(commitFieldsForThread([], defaults), []);
	assert.deepEqual(
		commitFieldsForThread([{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body', required: false,
		}], defaults),
		[{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		}],
	);
});

void test('moves deprecated fields last and excludes them from new commit input', () => {
	const fields = normalizeCommitFields([
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
		activeCommitFields(fields).map((field) => field.key),
		['current_metric'],
	);
});

void test('builds a Dataview-queryable commit with a free-form body', () => {
	const fields = normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
		{
			key: 'effort', label: '人力消耗', control: 'select', storage: 'inline',
			required: false, options: ['quick', 'light', 'normal', 'deep'],
		},
		{
			key: 'commit_result', label: '阶段成果', control: 'textarea', storage: 'body',
			required: false,
		},
	]);
	assert.equal(buildCommitEntry({
		date: '2026-08-31',
		time: '14:35',
		blockId: 'cm-20260831-01',
		fields,
		values: {
			commit_summary: '完成表单设计',
			effort: 'light',
			commit_result: '可以自由配置字段。\n长文字保留在正文。',
		},
	}), [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_time:: 14:35] [commit_summary:: 完成表单设计] [effort:: light] ^cm-20260831-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
});

void test('round-trips multiline inline commit values without delimiter collisions', () => {
	const fields = normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'textarea', storage: 'inline',
			required: true,
		},
	]);
	const value = '第一行\n\n第二行 & 原样保留 &#10; 和 ]';
	const entry = buildCommitEntry({
		date: '2026-09-20',
		time: '12:30',
		blockId: 'cm-multiline-inline',
		fields,
		values: { commit_summary: value },
	});
	assert.match(entry, /\[commit_summary:: 第一行&#10;&#10;第二行 &#38; 原样保留 &#38;#10; 和 &#93;\]/u);
	assert.equal(parseCommitEntries(entry)[0]?.values.commit_summary, value);
});

void test('parses commit data from a thread member callout', () => {
	const parsed = parseCommitEntries([
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_time:: 14:35] [commit_summary:: 完成表单设计] [effort:: deep] ^cm-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
	assert.deepEqual(parsed, [{
		blockId: 'cm-01',
		values: {
			commit: 'true',
			commit_date: '2026-08-31',
			commit_time: '14:35',
			commit_summary: '完成表单设计',
			effort: 'deep',
		},
		body: [{
			label: '阶段成果',
			value: '可以自由配置字段。\n长文字保留在正文。',
		}],
	}]);
});

void test('finds the commit around a Live Preview source line', () => {
	const content = [
		'# Thread 工作区',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_summary:: 完成] ^cm-live',
		'>   - **阶段成果：** 可见',
		'',
		'后续内容',
	].join('\n');
	assert.equal(commitEntryAroundLine(content, 2)?.blockId, 'cm-live');
	assert.equal(commitEntryAroundLine(content, 4)?.values.commit_summary, '完成');
	assert.equal(commitEntryAroundLine(content, 6), undefined);
});

void test('appends commit callouts to a thread member', () => {
	const entry = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] ^cm-new',
	].join('\n');
	const original = [
		'# Thread 工作区',
		'',
		'自由记录',
		'',
	].join('\n');
	const result = appendCommitEntry(original, entry);
	assert.match(result, /自由记录\n\n> \[!thread-commit\].*\n> - \[commit:: true\]/);
	assert.ok(result.indexOf('自由记录') < result.indexOf('^cm-new'));
});

void test('inserts commit callouts at a thread member cursor line', () => {
	const original = [
		'# Thread 工作区',
		'',
		'第一段',
		'',
		'第二段',
	].join('\n');
	const lines = original.split('\n');
	const entry = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-01] ^cm-custom',
	].join('\n');
	const edit = commitInsertionEdit(lines, entry, 2);
	assert.deepEqual(edit.from, { line: 2, ch: 3 });
	assert.deepEqual(edit.to, { line: 4, ch: 0 });
	const offset = (position: { line: number; ch: number }): number =>
		lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0)
		+ position.ch;
	const result = original.slice(0, offset(edit.from))
		+ edit.replacement
		+ original.slice(offset(edit.to));
	assert.match(result, /第一段\n\n> \[!thread-commit\][\s\S]*\^cm-custom\n\n第二段/);
	assert.deepEqual(commitInsertionEdit(lines, entry, 3), {
		from: { line: 3, ch: 0 },
		to: { line: 3, ch: 0 },
		replacement: `${entry}\n`,
	});
});

void test('rejects commit cursor positions inside live frontmatter', () => {
	const lines = ['---', 'type: thread', 'parent: none', '---', '# Body'];
	assert.equal(cursorLineIsFrontmatter(lines, 2), true);
	assert.equal(cursorLineIsFrontmatter(lines, 4), false);
	assert.equal(cursorLineIsFrontmatter(['---', 'type: thread'], 1), true);
	assert.equal(cursorLineIsFrontmatter(['# Body'], 0), false);
});

void test('replaces one commit in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-01] [commit_summary:: 旧摘要] ^cm-edit',
		'>   - **详情：** 旧内容',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_summary:: 保留] ^cm-keep',
	].join('\n');
	const replacement = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-02] [commit_time:: 10:30] [commit_summary:: 新摘要] ^cm-edit',
		'>   - **详情：** 新内容',
	].join('\n');
	const result = replaceCommitEntry(original, 'cm-edit', replacement);
	assert.match(result, /> \[!thread-commit\]\n> - \[commit:: true\].*\[commit_date:: 2026-09-02\].*\[commit_time:: 10:30\]/);
	assert.match(result, /> - \[commit:: true\].*新摘要.*\^cm-edit/);
	assert.match(result, /> {3}- \*\*详情：\*\* 新内容/);
	assert.doesNotMatch(result, /旧摘要|旧内容/);
	assert.match(result, /保留.*\^cm-keep/);
	assert.equal(parseCommitEntries(result).length, 2);
});

void test('adds active template fields when editing an older commit', () => {
	const fields = normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'text', storage: 'inline',
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
	const edit = commitEditState(fields, {
		blockId: 'cm-old',
		values: {
			commit: 'true',
			commit_date: '2026-09-01',
			commit_summary: '旧记录',
			legacy_only: '保留',
		},
		body: [],
	});
	assert.deepEqual(edit.fields.map((field) => field.key), [
		'commit_summary', 'new_note', 'legacy_only',
	]);
	assert.equal(edit.values.new_note, undefined);
	assert.equal(edit.fields.find((field) => field.key === 'new_note')?.required, false);
	assert.equal(edit.fields.find((field) => field.key === 'legacy_only')?.deprecated, true);
});

void test('chooses markdown rendering by commit field shape', () => {
	assert.equal(commitFieldRenderMode({ control: 'text', storage: 'inline' }), 'inline-markdown');
	assert.equal(commitFieldRenderMode({ control: 'textarea', storage: 'body' }), 'block-markdown');
	assert.equal(commitFieldRenderMode({ control: 'textarea', storage: 'inline' }), 'block-markdown');
	assert.equal(commitFieldRenderMode({ control: 'text', storage: 'body' }), 'block-markdown');
	assert.equal(commitFieldRenderMode({ control: 'select', storage: 'inline' }), 'plain');
	assert.equal(commitFieldRenderMode({ control: 'number', storage: 'inline' }), 'plain');
	assert.equal(commitFieldRenderMode({ control: 'toggle', storage: 'inline' }), 'plain');
	assert.equal(commitFieldRenderMode({ control: 'date', storage: 'inline' }), 'plain');
});

void test('deletes one commit in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-02] [commit_summary:: 删除] ^cm-delete',
		'>   - **详情：** 一并删除',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-01] [commit_summary:: 保留] ^cm-keep',
	].join('\n');
	const result = deleteCommitEntry(original, 'cm-delete');
	assert.doesNotMatch(result, /删除|一并删除|cm-delete/);
	assert.match(result, /保留.*\^cm-keep/);
	assert.equal(parseCommitEntries(result).length, 1);
});

void test('supports only the six thread lifecycle status values', () => {
	assert.deepEqual(
		THREAD_STATUS_CHOICES.map((choice) => choice.value),
		['active', 'dormant', 'paused', 'review', 'completed', 'closed'],
	);
	assert.deepEqual(
		THREAD_CREATION_STATUS_CHOICES.map((choice) => choice.value),
		['active', 'dormant'],
	);
	assert.equal(isThreadStatus('idea'), false);
	assert.equal(isThreadStatus('committed'), false);
	assert.equal(threadStatusLabel('active'), '持续关注');
	const dormant = THREAD_STATUS_CHOICES.find((choice) => choice.value === 'dormant');
	assert.ok(dormant);
	assert.equal(threadStatusOptionLabel(dormant), 'dormant — 休眠');
	assert.equal(isOperationalThreadStatus('active'), true);
	assert.equal(isOperationalThreadStatus('dormant'), true);
	assert.equal(isOperationalThreadStatus('committed'), false);
	assert.equal(isOperationalThreadStatus('paused'), false);
});

void test('allows only operational non-descendants as a new thread parent', () => {
	const nodes = [
		{ id: 'root', status: 'active' },
		{ id: 'current', status: 'active', parent: 'root' },
		{ id: 'child', status: 'dormant', parent: 'current' },
		{ id: 'other', status: 'dormant' },
		{ id: 'paused', status: 'paused' },
	];
	assert.equal(wouldCreateThreadParentCycle(nodes, 'current', 'current'), true);
	assert.equal(wouldCreateThreadParentCycle(nodes, 'current', 'child'), true);
	assert.equal(wouldCreateThreadParentCycle(nodes, 'current', 'root'), false);
	assert.deepEqual(availableThreadParentIds(nodes, 'current'), ['root', 'other']);
});

void test('builds a filtered thread tree while retaining structural ancestors', () => {
	const tree = buildThreadOverviewTree([
		{ id: 'paused-root', title: 'Paused root', status: 'paused' },
		{ id: 'active-child', title: 'Active child', status: 'active', parent: 'paused-root' },
		{ id: 'review-child', title: 'Review child', status: 'review', parent: 'active-child' },
		{ id: 'dormant-root', title: 'Dormant root', status: 'dormant' },
		{ id: 'closed-root', title: 'Closed root', status: 'closed' },
	], new Set(DEFAULT_THREAD_OVERVIEW_STATUSES));

	assert.deepEqual(tree.map((node) => ({
		id: node.item.id,
		contextOnly: node.contextOnly,
		children: node.children.map((child) => child.item.id),
	})), [
		{ id: 'dormant-root', contextOnly: false, children: [] },
		{ id: 'paused-root', contextOnly: true, children: ['active-child'] },
	]);
	assert.equal(tree[1]?.children[0]?.contextOnly, false);
	assert.equal(tree[1] ? countThreadOverviewDescendants(tree[1]) : -1, 1);
	assert.deepEqual(DEFAULT_THREAD_OVERVIEW_STATUSES, ['active', 'dormant']);
});

void test('returns no overview nodes when no status is selected', () => {
	assert.deepEqual(buildThreadOverviewTree([
		{ id: 'active', title: 'Active', status: 'active' },
	], new Set()), []);
});

void test('filters the overview to matching attention nodes while retaining ancestors', () => {
	const tree = buildThreadOverviewTree([
		{ id: 'root', title: 'Root', status: 'active' },
		{ id: 'ready-child', title: 'Ready', status: 'active', parent: 'root' },
		{ id: 'quiet-child', title: 'Quiet', status: 'dormant', parent: 'root' },
	], new Set(DEFAULT_THREAD_OVERVIEW_STATUSES));
	const filtered = filterThreadOverviewTree(tree, (item) => item.id === 'ready-child');
	assert.deepEqual(filtered.map((node) => ({
		id: node.item.id,
		contextOnly: node.contextOnly,
		children: node.children.map((child) => ({
			id: child.item.id,
			contextOnly: child.contextOnly,
		})),
	})), [{
		id: 'root',
		contextOnly: true,
		children: [{ id: 'ready-child', contextOnly: false }],
	}]);
});

void test('cycles only through active thread roles and enters the first active role from outside', () => {
	const roles = [
		{ path: 'entry.md', status: 'active' as const },
		{ path: 'old-research.md', status: 'terminated' as const },
		{ path: 'context.md', status: 'active' as const },
	];
	assert.equal(nextActiveThreadRolePath(roles, 'entry.md'), 'context.md');
	assert.equal(nextActiveThreadRolePath(roles, 'context.md'), 'entry.md');
	assert.equal(nextActiveThreadRolePath(roles, 'old-research.md'), 'entry.md');
	assert.equal(
		nextActiveThreadRolePath([{ path: 'old.md', status: 'terminated' }], 'old.md'),
		undefined,
	);
});

void test('resolves current wikilinks and aliases', () => {
	assert.equal(stripWikiLink('[[睡眠管理#Context|睡眠管理]]'), '睡眠管理');
	assert.equal(wikiLinkAlias('[[睡眠管理|睡眠管理]]'), '睡眠管理');
	assert.equal(wikiLinkAlias('[[睡眠管理]]'), undefined);
});

void test('task readiness separates future, holding, ideas, completion and deadlines', () => {
 assert.equal(todoDisposition(' ', '2026-10-01 预约', '2026-09-09'), 'future');
 assert.equal(todoDisposition(' ', '预约 📅 2026-10-01', '2026-09-09'), 'ready');
 assert.equal(todoDisposition(' ', '预约 ⏳ 2026-10-01', '2026-09-09'), 'future');
 assert.equal(todoDisposition(' ', '预约 🛫 2026-09-09', '2026-09-09'), 'ready');
 assert.equal(todoDisposition(' ', '等回复 [holding:: true]', '2026-09-09'), 'holding');
 assert.equal(todoDisposition('!', '考虑一下', '2026-09-09'), 'idea');
 assert.equal(todoDisposition('x', '完成', '2026-09-09'), undefined);
 assert.equal(todoDisposition('-', '取消', '2026-09-09'), undefined);
 assert.equal(todoDisposition(' ', '', '2026-09-09'), undefined);
 assert.equal(todoDisposition('?', '自定义', '2026-09-09'), 'unknown');
});

void test('task readiness respects date windows and the current repeat occurrence', () => {
	assert.equal(
		todoDisposition(' ', '记录恢复 [window_start:: 2026-09-19]', '2026-09-18'),
		'future',
	);
	assert.equal(
		todoDisposition(' ', '记录恢复 [window_start:: 2026-09-18]', '2026-09-18'),
		'ready',
	);
	assert.equal(todoDisposition(' ', '记录恢复 [scheduled:: 2026-09-19]', '2026-09-18'), 'future');
});

void test('accepts only explicit 24-hour HH:mm values', () => {
	assert.equal(is24HourTime('00:00'), true);
	assert.equal(is24HourTime('23:59'), true);
	assert.equal(is24HourTime('24:00'), false);
	assert.equal(is24HourTime('12:60'), false);
	assert.equal(is24HourTime('9:30'), false);
	assert.equal(is24HourTime('09:30 PM'), false);
});

void test('parses task references only through the distinct reference_task_id field', () => {
	assert.equal(
		parseTaskReference('reference_task_id: task-abcdef123456'),
		'task-abcdef123456',
	);
	assert.equal(
		parseTaskReference('[reference_task_id:: task-abcdef123456]'),
		'task-abcdef123456',
	);
	assert.equal(parseTaskReference('task_id: task-abcdef123456'), undefined);
	assert.equal(parseTaskReference('task-abcdef123456'), undefined);
});

void test('task form fields round-trip without losing markdown task state or other metadata', () => {
	const source = '  > - [+] 记录恢复 [task_id:: task-123456789abc] '
		+ '[window_start:: 2026-09-18] [window_end:: 2026-09-20] '
		+ '[effort:: quick] [scheduled:: 2026-09-18] [repeat:: FREQ=WEEKLY] '
		+ '^task-recovery';
	const parsed = parseTaskLine(source);
	assert.ok(parsed);
	assert.deepEqual(parsed.data, {
		...EMPTY_TASK,
		status: 'committed',
		taskId: 'task-123456789abc',
		content: '记录恢复',
		pinned: false,
		windowStart: '2026-09-18',
		windowEnd: '2026-09-20',
		effort: 'quick',
		repeat: true,
		scheduled: '2026-09-18',
		repeatFrequency: 'weekly',
		repeatInterval: 1,
		repeatMonthDay: 1,
	});
	const rebuilt = buildTaskLine(parsed.data, parsed);
	assert.match(rebuilt, /^ {2}> - \[\+\] 记录恢复/u);
	assert.doesNotMatch(rebuilt, /\[thread_pin::/u);
	assert.match(rebuilt, /\^task-recovery$/u);
	assert.deepEqual(parseTaskLine(rebuilt)?.data, parsed.data);
});

void test('task validation keeps date bounds optional and validates repeat state', () => {
	const base: TaskData = {
		...EMPTY_TASK,
		taskId: 'task-123456789abc',
		content: '整理会议结论',
		pinned: false,
		windowStart: '',
		windowEnd: '',
		effort: 'normal',
		repeat: false,
		scheduled: '',
		repeatFrequency: 'daily',
		repeatInterval: 2,
		repeatMonthDay: 1,
	};
	assert.equal(taskValidationError(base), undefined);
	assert.equal(taskValidationError({ ...base, taskId: '' }), 'task-id');
	assert.match(createTaskId(), /^task-[a-z0-9]{12}$/u);
	assert.equal(taskValidationError({
		...base,
		windowStart: '2026-09-19',
		windowEnd: '2026-09-18',
	}), 'window-order');
	assert.equal(taskValidationError({ ...base, repeat: true }), 'schedule-date');
	assert.equal(taskValidationError({
		...base,
		repeat: true,
		scheduled: '2026-09-18',
		repeatFrequency: 'daily',
		repeatInterval: 0,
	}), 'repeat-interval');
});

void test('formats task windows as one compact boundary range', () => {
	assert.equal(taskWindowLabel({
		windowStart: '2026-09-10',
		windowEnd: '2026-09-15',
	}), '2026-09-10 ～ 2026-09-15');
	assert.equal(taskWindowLabel({ windowStart: '2026-09-10', windowEnd: '' }), '2026-09-10 ～');
	assert.equal(taskWindowLabel({ windowStart: '', windowEnd: '2026-09-15' }), '～ 2026-09-15');
});

void test('formats recurring task current dates for compact rendering', () => {
	assert.equal(taskScheduledLabel('2026-09-21', '2026-09-21', 'Today'), 'Today');
	assert.equal(taskScheduledLabel('2026-10-02', '2026-09-21', 'Today'), '10/2');
	assert.equal(taskScheduledLabel('2027-01-03', '2026-09-21', 'Today'), '2027/1/3');
});

void test('classifies task windows before, during and after their date range', () => {
	const range = { windowStart: '2026-09-10', windowEnd: '2026-09-15' };
	assert.equal(taskWindowState(range, '2026-09-09'), 'upcoming');
	assert.equal(taskWindowState(range, '2026-09-10'), 'current');
	assert.equal(taskWindowState(range, '2026-09-15'), 'current');
	assert.equal(taskWindowState(range, '2026-09-16'), 'overdue');
	assert.equal(taskWindowState({ windowStart: '', windowEnd: '2026-09-15' }, '2026-09-10'), 'current');
	assert.equal(taskWindowState({ windowStart: '2026-09-10', windowEnd: '' }, '2026-09-09'), 'upcoming');
	assert.equal(taskWindowState({ windowStart: '', windowEnd: '' }, '2026-09-10'), undefined);
});

void test('advances one repeating task in place and preserves its relative date window', () => {
	const monthly: TaskData = {
			...EMPTY_TASK,
		taskId: 'task-123456789abc',
		content: '月末复盘',
		pinned: false,
		windowStart: '2026-01-30',
		windowEnd: '2026-02-01',
		effort: 'light',
		repeat: true,
		scheduled: '2026-01-31',
		repeatFrequency: 'monthly',
		repeatInterval: 1,
		repeatMonthDay: 31,
	};
	const february = advanceTaskData(monthly);
	assert.ok(february);
	assert.deepEqual(february, {
		...monthly,
		scheduled: '2026-02-28',
		windowStart: '2026-02-27',
		windowEnd: '2026-03-01',
	});
	assert.equal(advanceTaskData(february)?.scheduled, '2026-03-31');
	assert.equal(
		advanceTaskLine('- [x] 每日记录 [task_id:: task-123456789abc] '
			+ '[scheduled:: 2026-09-18] [repeat:: FREQ=DAILY]'),
		'- [ ] 每日记录 [task_id:: task-123456789abc] '
			+ '[completed_occurrences:: 2026-09-18] [scheduled:: 2026-09-19] [repeat:: FREQ=DAILY]',
	);
});

void test('skips past repeat occurrences when advancing while preserving the window offset', () => {
	const daily: TaskData = {
		...EMPTY_TASK,
		taskId: 'task-123456789abc',
		content: '每日记录',
		pinned: false,
		windowStart: '2026-09-17',
		windowEnd: '2026-09-18',
		effort: 'quick',
		repeat: true,
		scheduled: '2026-09-18',
		repeatFrequency: 'daily',
		repeatInterval: 1,
		repeatMonthDay: 1,
	};
	assert.deepEqual(advanceTaskData(daily, '2026-09-21'), {
		...daily,
		scheduled: '2026-09-21',
		windowStart: '2026-09-20',
		windowEnd: '2026-09-21',
	});
	assert.equal(advanceTaskData({ ...daily, scheduled: '2026-09-21' }, '2026-09-21')?.scheduled, '2026-09-22');
	assert.equal(advanceTaskData({
		...daily,
		scheduled: '2026-09-01',
		repeatFrequency: 'weekly',
	}, '2026-09-21')?.scheduled, '2026-09-22');
	assert.equal(advanceTaskData({
		...daily,
		scheduled: '2026-01-31',
		repeatFrequency: 'monthly',
		repeatMonthDay: 31,
	}, '2026-03-01')?.scheduled, '2026-03-31');
});

void test('every N day, week, month and year rules round-trip and advance by calendar units', () => {
	for (const [freq, rule, next] of [
		['daily', 'FREQ=DAILY;INTERVAL=3', '2024-02-03'],
		['weekly', 'FREQ=WEEKLY;INTERVAL=2', '2024-02-14'],
		['monthly', 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=31', '2024-04-30'],
		['yearly', 'FREQ=YEARLY;INTERVAL=2;BYMONTH=1;BYMONTHDAY=31', '2026-01-31'],
	] as const) {
		const parsed = parseTaskLine(`- [ ] 定期检查 [task_id:: task-123456789abc] [scheduled:: 2024-01-31] [repeat:: ${rule}]`)!;
		assert.equal(parsed.data.repeatFrequency, freq);
		assert.equal(advanceTaskData(parsed.data)?.scheduled, next);
		assert.deepEqual(parseTaskLine(buildTaskLine(parsed.data, parsed))?.data, parsed.data);
		for (const interval of [0, -1, 1.5, NaN, Infinity]) {
			assert.equal(taskValidationError({ ...parsed.data, repeatInterval: interval }), 'repeat-interval');
		}
		assert.equal(taskValidationError({ ...parsed.data, repeatInterval: 1 }), undefined);
	}
});

void test('calendar recurrence preserves leap-day and month-end anchors while skipping old periods', () => {
	const yearly = parseTaskLine('- [ ] 年度检查 [scheduled:: 2024-02-29] [repeat:: FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29]')!.data;
	const next = advanceTaskData(yearly)!;
	assert.equal(next.scheduled, '2025-02-28');
	assert.equal(next.repeatMonthDay, 29);
	assert.equal(advanceTaskData(next, '2028-01-01')?.scheduled, '2028-02-29');
	assert.equal(advanceTaskData({ ...yearly, repeatInterval: 2 }, '2027-01-01')?.scheduled, '2028-02-29');
	const quarterly = parseTaskLine('- [ ] 季度检查 [scheduled:: 2026-01-31] [window_start:: 2026-01-30] [window_end:: 2026-02-01] [repeat:: FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=31]')!.data;
	const advanced = advanceTaskData(quarterly, '2026-08-01')!;
	assert.equal(advanced.scheduled, '2026-10-31');
	assert.equal(advanced.windowStart, '2026-10-30');
	assert.equal(advanced.windowEnd, '2026-11-01');
	const weekly = parseTaskLine('- [ ] 双周检查 [scheduled:: 2026-10-01] [repeat:: FREQ=WEEKLY;INTERVAL=2]')!.data;
	assert.equal(advanceTaskData(weekly, '2026-10-21')?.scheduled, '2026-10-29');
	const days = parseTaskLine('- [ ] 三天一次 [scheduled:: 2026-10-01] [repeat:: FREQ=DAILY;INTERVAL=3]')!.data;
	assert.equal(days.repeatFrequency, 'daily');
	assert.equal(days.repeatInterval, 3);
	assert.equal(advanceTaskData(days, '2026-10-21')?.scheduled, '2026-10-22');
});

void test('converts the current text line into an editable task draft', () => {
	const plain = taskDraftFromTextLine('  正文');
	assert.equal(plain.prefix, '  - [');
	assert.equal(plain.data.content, '正文');
	assert.equal(buildTaskLine({ ...plain.data, taskId: 'task-123456789abc' }, plain),
		'  - [ ] 正文 [task_id:: task-123456789abc]');

	const list = taskDraftFromTextLine('> 1. 列表正文 ^keep');
	assert.equal(list.prefix, '> 1. [');
	assert.equal(list.data.content, '列表正文');
	assert.equal(list.blockId, '^keep');
	assert.equal(buildTaskLine({ ...list.data, taskId: 'task-123456789abc' }, list),
		'> 1. [ ] 列表正文 [task_id:: task-123456789abc] ^keep');
});

void test('task commits are inserted after the complete task block', () => {
	const source = [
		'# Work',
		'- [ ] Main task [task_id:: task-main]',
		'  continuation',
		'  - [ ] child task',
		'',
		'- [ ] Next task',
	].join('\n');
	const entry = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-22] ^cm-test',
	].join('\n');
	assert.equal(insertCommitAfterTask(source, 1, entry), [
		'# Work',
		'- [ ] Main task [task_id:: task-main]',
		'  continuation',
		'  - [ ] child task',
		'',
		entry,
		'',
		'- [ ] Next task',
		'',
	].join('\n'));
});

void test('filters overview tasks to today active or all unfinished tasks', () => {
	const tasks = [
		{ id: 'ready', disposition: 'ready' as const },
		{ id: 'future', disposition: 'future' as const },
		{ id: 'holding', disposition: 'holding' as const },
		{ id: 'idea', disposition: 'idea' as const },
		{ id: 'committed', disposition: 'committed' as const },
		{ id: 'unknown', disposition: 'unknown' as const },
	];
	assert.deepEqual(filterAttentionTasks(tasks, 'today').map((task) => task.id), ['ready']);
	assert.deepEqual(filterAttentionTasks(tasks, 'all').map((task) => task.id), [
		'ready',
		'future',
		'idea',
		'committed',
		'unknown',
	]);
});

void test('pins tasks in their source line without changing their identity', () => {
	const source = '- [ ] 分析恢复趋势 ^task-recovery';
	const pinned = taskLineWithPin(source, true);
	assert.equal(
		pinned,
		'- [ ] 分析恢复趋势 [thread_pin:: true] ^task-recovery',
	);
	assert.equal(taskIsPinned(pinned), true);
	assert.equal(
		taskTextWithoutPin('分析恢复趋势 [thread_pin:: true] ^task-recovery'),
		'分析恢复趋势 ^task-recovery',
	);
	assert.equal(taskLineWithPin(pinned, true), pinned);
	assert.equal(taskLineWithPin(pinned, false), source);
	assert.equal(
		taskLineWithPin('> - [ ] 记录睡眠', true),
		'> - [ ] 记录睡眠 [thread_pin:: true]',
	);
});

void test('subtree attention includes descendants but suspends frozen branches and deduplicates shared tasks', () => {
 const nodes = [
  { id: 'root', status: 'active' },
  { id: 'sleep', parent: 'root', status: 'dormant' },
  { id: 'frozen', parent: 'root', status: 'paused' },
  { id: 'child', parent: 'frozen', status: 'active' },
 ];
 const tasks = [
  { key: 'one', owner: 'sleep', disposition: 'ready' as const },
  { key: 'one', owner: 'root', disposition: 'ready' as const },
  { key: 'two', owner: 'child', disposition: 'ready' as const },
 ];
 const result = summarizeAttention('root', nodes, tasks);
 assert.equal(result.open, 2); assert.equal(result.ready, 1); assert.equal(result.suspended, 1);
 assert.equal(summarizeAttention('child', nodes, tasks).ready, 0);
 assert.match(attentionHint('dormant', summarizeAttention('sleep', nodes, tasks)), /需要处理/);
 assert.equal(attentionHint('dormant', summarizeAttention('sleep', nodes, [])), '');
 assert.match(attentionHint('active', summarizeAttention('root', nodes, [])), /考虑休眠/);
});

void test('cycles terminate with visible warning and future tasks are not an empty subtree', () => {
 const nodes = [{ id: 'a', parent: 'b', status: 'active' }, { id: 'b', parent: 'a', status: 'active' }];
 assert.equal(summarizeAttention('a', nodes, []).cycle, true);
 const summary = summarizeAttention('a', [{ id: 'a', status: 'active' }], [{ key: 'a:1', owner: 'a', disposition: 'future' }]);
 assert.equal(summary.open, 1); assert.equal(summary.ready, 0);
 assert.doesNotMatch(attentionHint('active', summary), /考虑休眠/);
});

void test('breadcrumb switcher exposes only operational threads without changing hierarchy', () => {
	const threads = [
		{ title: '睡眠', status: 'dormant' },
		{ title: '插件', status: 'active' },
		{ title: '旅行', status: 'paused' },
	] as never[];
	assert.deepEqual(
		filterBreadcrumbThreads(threads).map((thread) => thread.title),
		['插件', '睡眠'],
	);
});

void test('breadcrumb child menus open toward available space', () => {
	assert.equal(breadcrumbMenuSide(40, 64, 800, 300, false), 'below');
	assert.equal(breadcrumbMenuSide(730, 754, 800, 300, false), 'above');
	assert.equal(breadcrumbMenuSide(730, 754, 800, 100, true), 'above');
});

void test('bottom breadcrumbs reserve space only for overlapping status bars', () => {
	const bar = { left: 0, right: 1440, top: 870, bottom: 900 };
	assert.equal(
		breadcrumbRightClearance(bar, { left: 1227, right: 1440, top: 873, bottom: 900 }),
		221,
	);
	assert.equal(
		breadcrumbRightClearance({ ...bar, right: 700 }, { left: 1227, right: 1440, top: 873, bottom: 900 }),
		0,
	);
	assert.equal(
		breadcrumbRightClearance(bar, { left: 1227, right: 1440, top: 900, bottom: 927 }),
		0,
	);
});

void test('localizes model-provided labels without changing stored values', () => {
	setLocale('en');
	try {
		assert.equal(threadStatusLabel('active'), 'Active');
		const dormant = THREAD_STATUS_CHOICES.find((choice) => choice.value === 'dormant');
		assert.ok(dormant);
		assert.equal(threadStatusOptionLabel(dormant), 'dormant — Dormant');
		assert.deepEqual(
			normalizeCommitFields(undefined).map((field) => field.label),
			['Summary', 'Effort'],
		);
		assert.match(parseThreadEntriesQuery('invalid').errors[0] ?? '', /^Line 1/);
	} finally {
		setLocale('zh');
	}
});

void test('breadcrumb tooltips face the document area', () => {
	assert.equal(breadcrumbTooltipPlacement('top'), 'bottom');
	assert.equal(breadcrumbTooltipPlacement('bottom'), 'top');
});

function holdingTask(id: string, changes: Partial<TaskData> = {}): TaskData {
	return { ...EMPTY_TASK, taskId: `task-${id.repeat(12)}`, content: id, ...changes };
}

void test('task states round trip independently of holding and retain other fields', () => {
	for (const status of ['idea', 'committed', 'open', 'completed', 'cancelled'] as const) {
		const data = holdingTask('a', { status, holding: true, holdingReview: '2026-10-01', holdingFor: ['task-bbbbbbbbbbbb'] });
		const line = buildTaskLine(data);
		assert.ok(line.startsWith(`- [${taskStatusMarker(status)}]`));
		assert.deepEqual(parseTaskLine(line)?.data, data);
		const released = releaseTaskHolding(data);
		assert.equal(released.status, status);
		assert.equal(released.holding, false);
		assert.deepEqual(released.holdingFor, []);
		assert.equal(released.holdingReview, '');
		assert.doesNotMatch(buildTaskLine(released), /holding/u);
	}
});

void test('committed and idea never become ready merely because their date has arrived', () => {
	assert.equal(todoDisposition('+', 'Committed [window_start:: 2020-01-01]', '2026-09-23'), 'committed');
	assert.equal(todoDisposition('!', 'Idea [window_end:: 2020-01-01]', '2026-09-23'), 'idea');
	for (const marker of ['!', '+', ' ']) {
		assert.equal(todoDisposition(marker, 'Held [holding:: true] [holding_review:: 2020-01-01]', '2026-09-23'), 'holding');
	}
});

void test('manual holding remains held before and after the review date', () => {
	for (const date of ['', '2020-01-01', '2099-12-31']) {
		assert.equal(holdingResult(holdingTask('a', { holding: true, holdingReview: date }), new Map()), 'manual');
	}
	assert.equal(taskValidationError(holdingTask('a', { holding: true, holdingReview: '2026-02-30' })), 'holding-date');
});

void test('all dependencies must complete; cancelled missing and duplicate tasks require attention', () => {
	const data = holdingTask('a', { status: 'committed', holding: true, holdingFor: ['task-bbbbbbbbbbbb', 'task-cccccccccccc'] });
	const b = holdingTask('b', { status: 'completed' });
	const c = holdingTask('c');
	const lookup = new Map([[b.taskId, [b]], [c.taskId, [c]]]);
	assert.equal(holdingResult(data, lookup), 'pending');
	lookup.set(c.taskId, [{ ...c, status: 'completed' }]);
	assert.equal(holdingResult(data, lookup), 'ready');
	assert.equal(holdingResult({ ...data, holdingReview: '2099-12-31' }, lookup), 'ready');
	lookup.set(c.taskId, [{ ...c, status: 'cancelled' }]);
	assert.equal(holdingResult(data, lookup), 'invalid');
	lookup.set(c.taskId, [c, c]);
	assert.equal(holdingResult(data, lookup), 'invalid');
	lookup.delete(c.taskId);
	assert.equal(holdingResult(data, lookup), 'invalid');
	assert.equal(holdingResult(releaseTaskHolding(data), lookup), 'manual');
});

void test('holding prevents self dependency, indirect cycles and malformed references', () => {
	const a = holdingTask('a', { holding: true, holdingFor: ['task-bbbbbbbbbbbb'] });
	const b = holdingTask('b', { holding: true, holdingFor: [a.taskId] });
	assert.equal(holdingGraphError(a, new Map([[b.taskId, [b]], [a.taskId, [a]]])), true);
	assert.equal(holdingGraphError({ ...a, holdingFor: [a.taskId] }, new Map()), true);
	assert.equal(holdingResult({ ...a, holdingFor: ['bad-id'] }, new Map()), 'invalid');
	const leaf = holdingTask('c');
	assert.equal(holdingGraphError({ ...a, holdingFor: [leaf.taskId] }, new Map([[leaf.taskId, [leaf]]])), false);
});

void test('recurring dependency requires completion of the selected occurrence, not skipping it', () => {
	const recurring = holdingTask('b', { repeat: true, scheduled: '2026-09-20' });
	const data = holdingTask('a', { holding: true, holdingFor: [dependencyReference(recurring)] });
	const skipped = advanceTaskData(recurring, '2026-09-23')!;
	assert.equal(holdingResult(data, new Map([[recurring.taskId, [skipped]]])), 'pending');
	const completed = advanceTaskData(completeTaskData(recurring), '2026-09-23')!;
	assert.equal(completed.status, 'open');
	assert.deepEqual(completed.completedOccurrences, ['2026-09-20']);
	assert.equal(holdingResult(data, new Map([[recurring.taskId, [completed]]])), 'ready');
	assert.equal(holdingResult({ ...data, holdingFor: [`${recurring.taskId}@2026-09-21`] }, new Map([[recurring.taskId, [completed]]])), 'pending');
	assert.equal(holdingResult({ ...data, holdingFor: [recurring.taskId] }, new Map([[recurring.taskId, [recurring]]])), 'invalid');
	const line = advanceTaskLine(buildTaskLine({ ...recurring, status: 'completed' }), '2026-09-23')!;
	assert.deepEqual(parseTaskLine(line)?.data.completedOccurrences, ['2026-09-20']);
});

void test('task scanner excludes YAML and fenced/indented samples, preserving real nested tasks', () => {
	const content = ['---', 'example:', '- [ ] YAML', '---', '# Notes', '```md', '- [ ] fenced', '```',
		'~~~md', '- [ ] tilde fenced', '~~~', '', '    - [ ] indented code', '',
		'- [ ] real', '    - [+] real nested', '> - [!] quoted task'].join('\n');
	assert.deepEqual(scanTaskLines(content).map(task => task.parsed.data.content), ['real', 'real nested', 'quoted task']);
});

void test('state queues exclude holding and separate idea, committed and open', () => {
	const tasks = ['idea', 'committed', 'ready', 'future', 'holding', 'unknown'].map(disposition => ({ disposition })) as { disposition: import('../src/thread-attention-model').TodoDisposition }[];
	assert.deepEqual(filterAttentionTasks(tasks, 'idea').map(task => task.disposition), ['idea']);
	assert.deepEqual(filterAttentionTasks(tasks, 'committed').map(task => task.disposition), ['committed']);
	assert.deepEqual(filterAttentionTasks(tasks, 'open').map(task => task.disposition), ['ready', 'future']);
});

void test('one-time state migration preserves note content, ignores examples and is idempotent', () => {
	const source = ['---', 'example:', '- [?] YAML', '---', '```md', '- [>] example', '```',
		'- [i] Idea', '- [?] Committed [task_id:: task-aaaaaaaaaaaa] ^anchor',
		'- [:] Already committed [task_id:: task-cccccccccccc]',
		'- [>] Waiting [task_id:: task-bbbbbbbbbbbb] ^waiting', '- [x] Done'].join('\n');
	const migrated = migrateTaskStates(source);
	assert.deepEqual(migrated.changedLines, [8, 9, 10, 11]);
	assert.ok(migrated.content.includes('- [!] Idea'));
	assert.ok(migrated.content.includes('- [+] Committed [task_id:: task-aaaaaaaaaaaa] ^anchor'));
	assert.ok(migrated.content.includes('- [+] Already committed [task_id:: task-cccccccccccc]'));
	assert.ok(migrated.content.includes('- [ ] Waiting [task_id:: task-bbbbbbbbbbbb] [holding:: true] ^waiting'));
	assert.ok(migrated.content.includes('- [?] YAML'));
	assert.ok(migrated.content.includes('- [>] example'));
	assert.deepEqual(migrateTaskStates(migrated.content), { content: migrated.content, changedLines: [] });
});

void test('indented examples inside lists are excluded from the dependency graph', () => {
	const source = ['- Parent', '', '        - [x] Code example', '', '    - [ ] Nested task', '        - [ ] Deep task'].join('\n');
	assert.deepEqual(scanTaskLines(source).map(task => task.parsed.data.content), ['Nested task', 'Deep task']);
});
