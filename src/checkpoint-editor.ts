import {
	Decoration,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type EditorView,
	type ViewUpdate,
} from '@codemirror/view';
import type { Range } from '@codemirror/state';
import {
	editorInfoField,
	editorLivePreviewField,
	moment,
	setIcon,
	type MarkdownRenderChild,
	type TFile,
} from 'obsidian';
import {
	checkpointEntryAroundLine,
	type ParsedCheckpointEntry,
} from './checkpoint-core';
import {
	inlineLogEntryAroundLine,
	type ParsedInlineLogEntry,
} from './inline-log';
import { t } from './i18n';
import {
	parseTaskLine,
	taskCurrentLabel,
	taskRepeatLabel,
	taskWindowLabel,
	taskWindowState,
	type TaskData,
	type TaskEffort,
} from './task-model';

const CHECKPOINT_CALLOUT_SELECTOR = '.callout[data-callout="thread-checkpoint"]';
const LOG_CALLOUT_SELECTOR = '.callout[data-callout="thread-log"]';
const TASK_RENDER_FIELD = /\s*\[(?:task_id|window_start|window_end|effort|current|repeat|thread_pin)::\s*[^\]]*\]/gu;

function taskRepeatRuleDisplay(data: TaskData): string {
	const label = taskRepeatLabel(data);
	return label === 'Daily' ? t('Daily')
		: label === 'Weekly' ? t('Weekly')
			: label === 'Monthly' ? t('Monthly')
				: t('Every {count} days', { count: data.repeatInterval });
}

class TaskSummaryWidget extends WidgetType {
	private readonly signature: string;

	constructor(
		private readonly file: TFile,
		private readonly line: number,
		private readonly sourceLine: string,
		private readonly data: TaskData,
		private readonly onNext: (file: TFile, line: number, sourceLine: string) => void,
		private readonly onEdit: (
			file: TFile,
			line: number,
			sourceLine: string,
			data: TaskData,
		) => void,
	) {
		super();
		this.signature = JSON.stringify(data);
	}

	eq(other: TaskSummaryWidget): boolean {
		return this.file.path === other.file.path
			&& this.line === other.line
			&& this.sourceLine === other.sourceLine
			&& this.signature === other.signature;
	}

	toDOM(view: EditorView): HTMLElement {
		const host = view.dom.cloneNode(false) as HTMLElement;
		const container = host.createSpan({ cls: 'thread-journal-task-preview' });
		const addChip = (text: string, icon: string, modifier = ''): void => {
			const chip = container.createSpan({
				cls: `thread-journal-task-preview-chip${modifier ? ` is-${modifier}` : ''}`,
			});
			setIcon(chip.createSpan({ cls: 'thread-journal-task-chip-icon' }), icon);
			chip.createSpan({ text });
		};
		const window = taskWindowLabel(this.data);
		if (window) {
			addChip(window, 'calendar-range', taskWindowState(
				this.data,
				moment().format('YYYY-MM-DD'),
			));
		}
		if (this.data.effort) {
			const labels: Record<Exclude<TaskEffort, ''>, string> = {
				quick: t('Quick'),
				light: t('Light'),
				normal: t('Normal effort'),
				deep: t('Deep'),
			};
			addChip(labels[this.data.effort], 'gauge');
		}
		if (this.data.repeat) {
			const rule = taskRepeatRuleDisplay(this.data);
			const current = taskCurrentLabel(
				this.data.current,
				moment().format('YYYY-MM-DD'),
				t('Today'),
			);
			const repeat = container.createSpan({
				cls: 'thread-journal-task-preview-chip is-repeat',
				attr: { title: rule },
			});
			const next = repeat.createEl('button', {
				cls: 'clickable-icon thread-journal-task-repeat-next',
				attr: {
					type: 'button',
					'aria-label': `${rule} · ${t('To next')}`,
					title: `${rule} · ${t('To next')}`,
				},
			});
			setIcon(next, 'repeat-2');
			if (current) repeat.createSpan({ text: current });
			next.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			next.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				next.disabled = true;
				this.onNext(this.file, this.line, this.sourceLine);
			});
		}
		const actions = container.createSpan({ cls: 'thread-journal-task-preview-actions' });
		const edit = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-task-preview-edit',
			attr: { type: 'button', 'aria-label': t('Edit task'), title: t('Edit task') },
		});
		setIcon(edit, 'pencil');
		edit.addEventListener('mousedown', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		edit.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.onEdit(this.file, this.line, this.sourceLine, this.data);
		});
		return container;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

export function checkpointEditorExtension(
	isThreadMember: (file: TFile) => boolean,
	onRender: (
		callout: HTMLElement,
		file: TFile,
		entry: ParsedCheckpointEntry,
		registerChild: (child: MarkdownRenderChild) => void,
	) => Promise<void>,
	onRenderLog: (
		callout: HTMLElement,
		file: TFile,
		entry: ParsedInlineLogEntry,
		registerChild: (child: MarkdownRenderChild) => void,
	) => Promise<void>,
	onTaskNext: (file: TFile, line: number, sourceLine: string) => void,
	onTaskEdit: (file: TFile, line: number, sourceLine: string, data: TaskData) => void,
) {
	return ViewPlugin.fromClass(class CheckpointEditorCallouts {
		decorations: DecorationSet;
		private frame?: number;
		private readonly observer?: MutationObserver;
		private readonly renderChildren = new Set<MarkdownRenderChild>();

		constructor(private readonly view: EditorView) {
			this.decorations = this.buildTaskDecorations();
			const Observer = view.dom.ownerDocument.defaultView?.MutationObserver;
			if (Observer) {
				this.observer = new Observer(() => this.schedule());
				this.observer.observe(view.dom, { childList: true, subtree: true });
			}
			this.schedule();
		}

		update(update: ViewUpdate): void {
			if (
				update.docChanged
				|| update.viewportChanged
				|| update.geometryChanged
				|| update.selectionSet
			) {
				this.decorations = this.buildTaskDecorations();
				this.schedule();
			}
		}

		private buildTaskDecorations(): DecorationSet {
			const livePreview = this.view.state.field(editorLivePreviewField, false);
			const info = this.view.state.field(editorInfoField, false);
			const file = info?.file;
			if (!livePreview || !file || !isThreadMember(file)) return Decoration.none;
			const activeLines = new Set(this.view.state.selection.ranges.map((range) =>
				this.view.state.doc.lineAt(range.head).number));
			const seen = new Set<number>();
			const ranges: Range<Decoration>[] = [];
			for (const visible of this.view.visibleRanges) {
				let position = this.view.state.doc.lineAt(visible.from).from;
				while (position <= visible.to) {
					const line = this.view.state.doc.lineAt(position);
					if (!seen.has(line.number) && !activeLines.has(line.number)) {
						seen.add(line.number);
						const parsed = parseTaskLine(line.text);
						if (parsed) {
							for (const match of line.text.matchAll(TASK_RENDER_FIELD)) {
								const from = line.from + (match.index ?? 0);
								ranges.push(Decoration.replace({}).range(from, from + match[0].length));
							}
							if (parsed.data.taskId || taskWindowLabel(parsed.data)
								|| parsed.data.effort || parsed.data.repeat) {
								ranges.push(Decoration.widget({
									widget: new TaskSummaryWidget(
										file,
										line.number - 1,
										line.text,
										parsed.data,
										onTaskNext,
										onTaskEdit,
									),
									side: 1,
								}).range(line.to));
							}
						}
					}
					if (line.to >= visible.to || line.to >= this.view.state.doc.length) break;
					position = line.to + 1;
				}
			}
			return Decoration.set(ranges, true);
		}

		destroy(): void {
			this.observer?.disconnect();
			const win = this.view.dom.ownerDocument.defaultView;
			if (win && this.frame !== undefined) win.cancelAnimationFrame(this.frame);
			for (const child of this.renderChildren) child.unload();
			this.renderChildren.clear();
		}

		private schedule(): void {
			const win = this.view.dom.ownerDocument.defaultView;
			if (!win || this.frame !== undefined) return;
			this.frame = win.requestAnimationFrame(() => {
				this.frame = undefined;
				this.enhance();
			});
		}

		private enhance(): void {
			for (const child of this.renderChildren) {
				if (child.containerEl.isConnected) continue;
				child.unload();
				this.renderChildren.delete(child);
			}
			const livePreview = this.view.state.field(editorLivePreviewField, false);
			const info = this.view.state.field(editorInfoField, false);
			const file = info?.file;
			if (!livePreview || !file || !isThreadMember(file)) return;

			const source = this.view.state.doc.toString();
			this.view.dom.querySelectorAll<HTMLElement>(CHECKPOINT_CALLOUT_SELECTOR).forEach((callout) => {
				let position: number;
				try {
					position = this.view.posAtDOM(callout);
				} catch {
					return;
				}
				const line = this.view.state.doc.lineAt(position).number - 1;
				const entry = checkpointEntryAroundLine(source, line);
				if (!entry?.blockId) return;
				void onRender(callout, file, entry, (child) => {
					child.load();
					this.renderChildren.add(child);
				}).catch((error: unknown) => {
					console.error('Thread Journal failed to render checkpoint Markdown', error);
				});
			});
			this.view.dom.querySelectorAll<HTMLElement>(LOG_CALLOUT_SELECTOR).forEach((callout) => {
				let position: number;
				try {
					position = this.view.posAtDOM(callout);
				} catch {
					return;
				}
				const line = this.view.state.doc.lineAt(position).number - 1;
				const entry = inlineLogEntryAroundLine(source, line);
				if (!entry) return;
				void onRenderLog(callout, file, entry, (child) => {
					child.load();
					this.renderChildren.add(child);
				}).catch((error: unknown) => {
					console.error('Thread Journal failed to render log Markdown', error);
				});
			});
		}
	}, {
		decorations: (value) => value.decorations,
	});
}
