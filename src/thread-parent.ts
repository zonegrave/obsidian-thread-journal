import type { TFile } from 'obsidian';
import type { ThreadIndex } from './thread-index';
import {
	availableThreadParentIds,
	type ThreadParentNode,
} from './thread-parent-model';
import { isOperationalThreadStatus } from './thread-status-model';
import { t } from './i18n';
import type { ThreadInfo } from './types';

export class ThreadParentManager {
	constructor(private readonly index: ThreadIndex) {}

	getCandidates(threadFile: TFile): ThreadInfo[] {
		const thread = this.index.getThread(threadFile);
		if (!thread) return [];
		const currentParent = this.index.getParentFile(threadFile);
		const allThreads = this.index.getAllThreads();
		const nodes: ThreadParentNode[] = allThreads.map((item) => {
			const parent = this.index.getParentFile(item.file);
			return {
				id: item.id,
				status: item.status,
				parent: parent ? this.index.getThread(parent)?.id : undefined,
			};
		});
		const allowed = new Set(availableThreadParentIds(nodes, thread.id));
		return allThreads
			.filter((item) => allowed.has(item.id) || item.file.path === currentParent?.path)
			.sort((left, right) => left.title.localeCompare(right.title));
	}

	validateParent(threadFile: TFile, parent?: TFile): void {
		const thread = this.index.getThread(threadFile);
		if (!thread) throw new Error(t('Only a valid thread meta can have its parent changed.'));
		const currentParent = this.index.getParentFile(threadFile);
		if (currentParent?.path === parent?.path || (!currentParent && !parent)) {
			return;
		}
		if (parent) {
			const parentThread = this.index.getThread(parent);
			if (!parentThread || !isOperationalThreadStatus(parentThread.status)) {
				throw new Error(t('The parent thread must be active or dormant.'));
			}
			const descendants = this.descendantPaths(threadFile);
			if (parent.path === threadFile.path || descendants.has(parent.path)) {
				throw new Error(t('The current thread or one of its descendants cannot become its parent.'));
			}
		}
	}

	private descendantPaths(threadFile: TFile): Set<string> {
		const result = new Set<string>();
		const pending = [...this.index.getDirectChildren(threadFile)];
		while (pending.length > 0) {
			const next = pending.shift();
			if (!next || result.has(next.file.path)) continue;
			result.add(next.file.path);
			pending.push(...this.index.getDirectChildren(next.file));
		}
		return result;
	}
}
