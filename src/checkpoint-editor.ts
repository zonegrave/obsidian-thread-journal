import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import {
	editorInfoField,
	editorLivePreviewField,
	type TFile,
} from 'obsidian';
import {
	checkpointEntryAroundLine,
	type ParsedCheckpointEntry,
} from './checkpoint-core';

const CALLOUT_SELECTOR = '.callout[data-callout="thread-checkpoint"]';
const CONTROLS_SELECTOR = '.thread-journal-source-checkpoint-controls';

export function checkpointEditorExtension(
	isWorkspace: (file: TFile) => boolean,
	onEdit: (file: TFile, entry: ParsedCheckpointEntry) => void,
) {
	return ViewPlugin.fromClass(class CheckpointEditorButtons {
		private frame?: number;
		private readonly observer?: MutationObserver;

		constructor(private readonly view: EditorView) {
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
				this.schedule();
			}
		}

		destroy(): void {
			this.observer?.disconnect();
			const win = this.view.dom.ownerDocument.defaultView;
			if (win && this.frame !== undefined) win.cancelAnimationFrame(this.frame);
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
			const livePreview = this.view.state.field(editorLivePreviewField, false);
			const info = this.view.state.field(editorInfoField, false);
			const file = info?.file;
			if (!livePreview || !file || !isWorkspace(file)) {
				this.view.dom.querySelectorAll(CONTROLS_SELECTOR).forEach((element) => {
					element.remove();
				});
				return;
			}

			const source = this.view.state.doc.toString();
			this.view.dom.querySelectorAll<HTMLElement>(CALLOUT_SELECTOR).forEach((callout) => {
				if (callout.querySelector(CONTROLS_SELECTOR)) return;
				let position: number;
				try {
					position = this.view.posAtDOM(callout);
				} catch {
					return;
				}
				const line = this.view.state.doc.lineAt(position).number - 1;
				const entry = checkpointEntryAroundLine(source, line);
				if (!entry?.blockId) return;
				const title = callout.querySelector<HTMLElement>('.callout-title');
				if (!title) return;
				const controls = title.createDiv({
					cls: 'thread-journal-source-checkpoint-controls',
				});
				const edit = controls.createEl('button', {
					text: '编辑',
					attr: { type: 'button', 'aria-label': '编辑当前 checkpoint' },
				});
				edit.addEventListener('mousedown', (event) => {
					event.preventDefault();
					event.stopPropagation();
				});
				edit.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					onEdit(file, entry);
				});
			});
		}
	});
}
