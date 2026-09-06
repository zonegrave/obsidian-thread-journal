import { MarkdownView, type WorkspaceLeaf } from 'obsidian';

export function leafFilePath(leaf: WorkspaceLeaf): string | undefined {
	if (leaf.view instanceof MarkdownView) return leaf.view.file?.path;
	const state = leaf.getViewState().state;
	return typeof state?.file === 'string' ? state.file : undefined;
}
