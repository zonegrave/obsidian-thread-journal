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
import {
	inlineLogEntryAroundLine,
	type ParsedInlineLogEntry,
} from './inline-log';

const CHECKPOINT_CALLOUT_SELECTOR = '.callout[data-callout="thread-checkpoint"]';
const LOG_CALLOUT_SELECTOR = '.callout[data-callout="thread-log"]';

export function checkpointEditorExtension(
	isWorkspace: (file: TFile) => boolean,
	onRender: (
		callout: HTMLElement,
		file: TFile,
		entry: ParsedCheckpointEntry,
	) => void,
	onRenderLog: (
		callout: HTMLElement,
		file: TFile,
		entry: ParsedInlineLogEntry,
	) => void,
) {
	return ViewPlugin.fromClass(class CheckpointEditorCallouts {
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
			if (!livePreview || !file || !isWorkspace(file)) return;

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
				onRender(callout, file, entry);
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
				onRenderLog(callout, file, entry);
			});
		}
	});
}
