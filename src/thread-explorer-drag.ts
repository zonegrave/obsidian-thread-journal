import { Notice, setIcon, type App } from 'obsidian';
import { t } from './i18n';
import { ROOT_THREAD_ID } from './thread-root-model';
import { explorerMovePlan, type ExplorerNode } from './thread-explorer-order';
import { persistExplorerOrder } from './thread-explorer-order-service';

export class ExplorerDragController {
	private source?: ExplorerNode;
	private saving = false;
	private closed = false;
	constructor(private app: App, private host: HTMLElement, private nodes: () => ExplorerNode[],
		private reloadNodes: () => Promise<ExplorerNode[]>, private refresh: () => Promise<void>) {}
	get busy(): boolean { return Boolean(this.source) || this.saving; }

	bind(row: HTMLElement, name: HTMLElement, key: string, movable: boolean): void {
		row.setAttribute('data-explorer-key', key);
		if (movable && key !== `thread:${ROOT_THREAD_ID}`) {
			const handle = name.createSpan({ cls: 'thread-journal-explorer-drag-handle', attr: { draggable: 'true', title: t('Drag to reorder siblings'), 'aria-label': t('Drag to reorder siblings') } });
			name.insertBefore(handle, name.querySelector('.thread-journal-table-toggle'));
			setIcon(handle, 'grip-vertical');
			handle.addEventListener('click', event => event.stopPropagation());
			handle.addEventListener('dragstart', event => {
				if (this.saving || !event.dataTransfer) { event.preventDefault(); return; }
				this.source = this.nodes().find(node => node.key === key);
				if (!this.source) { event.preventDefault(); return; }
				event.stopPropagation(); event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('application/x-thread-explorer-node', key);
				for (const node of this.block(row)) node.addClass('is-explorer-dragging');
			});
			handle.addEventListener('dragend', () => { this.source = undefined; this.clear(); if (!this.saving && !this.closed) void this.refresh(); });
		}
		row.addEventListener('dragover', event => {
			const target = this.target(key); if (!target || !event.dataTransfer) return;
			event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
			this.clear(false);
			const after = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
			const block = this.block(row); (after ? block[block.length - 1]! : row).addClass(after ? 'is-explorer-drop-after' : 'is-explorer-drop-before');
			const scroll = row.closest<HTMLElement>('.thread-journal-table-scroll');
			if (scroll) { const bounds = scroll.getBoundingClientRect(); if (event.clientY < bounds.top + 36) scroll.scrollTop -= 24; else if (event.clientY > bounds.bottom - 36) scroll.scrollTop += 24; }
		});
		row.addEventListener('dragleave', event => { if (!(event.relatedTarget instanceof Node) || !row.contains(event.relatedTarget)) this.clear(false); });
		row.addEventListener('drop', event => {
			const target = this.target(key); if (!target || !this.source) return;
			event.preventDefault(); event.stopPropagation();
			const source = this.source; const side = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'after' : 'before';
			this.source = undefined; this.clear(); this.saving = true;
			void this.save(source, target, side);
		});
	}
	private target(key: string): ExplorerNode | undefined {
		const target = this.nodes().find(node => node.key === key);
		return !this.saving && this.source && target && target.key !== this.source.key && target.key !== `thread:${ROOT_THREAD_ID}` && target.parent === this.source.parent ? target : undefined;
	}
	private block(row: HTMLElement): HTMLElement[] {
		const nodes = [row]; const depth = Number(row.getAttribute('aria-level'));
		let next = row.nextElementSibling;
		while (next instanceof HTMLElement && Number(next.getAttribute('aria-level')) > depth) { nodes.push(next); next = next.nextElementSibling; }
		return nodes;
	}
	private clear(includeDrag = true): void { this.host.querySelectorAll(`${includeDrag ? '.is-explorer-dragging, ' : ''}.is-explorer-drop-before, .is-explorer-drop-after`).forEach(node => node.removeClass('is-explorer-dragging', 'is-explorer-drop-before', 'is-explorer-drop-after')); }
	private async save(source: ExplorerNode, target: ExplorerNode, side: 'before' | 'after'): Promise<void> {
		try {
			const nodes = await this.reloadNodes();
			if (this.closed) return;
			const current = nodes.find(node => node.key === source.key); const destination = nodes.find(node => node.key === target.key);
			if (!current || !destination || current.parent !== source.parent || destination.parent !== target.parent) throw new Error('The tree changed. Refresh and try again.');
			const plan = explorerMovePlan(nodes, source.key, target.key, side);
			await persistExplorerOrder(this.app, nodes.filter(node => node.parent === current.parent && node.key !== `thread:${ROOT_THREAD_ID}`), plan);
		} catch (error) { new Notice(t('Failed to save explorer order: {error}', { error: String(error) })); }
		finally { this.saving = false; if (!this.closed) await this.refresh(); }
	}
	async reset(parent: string): Promise<void> {
		if (this.busy) return;
		this.saving = true;
		try {
			const siblings = (await this.reloadNodes()).filter(node => node.parent === parent && node.key !== `thread:${ROOT_THREAD_ID}`);
			if (this.closed) return;
			await persistExplorerOrder(this.app, siblings, new Map(siblings.filter(node => node.order !== undefined).map(node => [node.path, undefined])));
		} catch (error) { new Notice(t('Failed to save explorer order: {error}', { error: String(error) })); }
		finally { this.saving = false; if (!this.closed) await this.refresh(); }
	}
	dispose(): void { this.closed = true; this.source = undefined; this.clear(); }
}
