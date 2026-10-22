import { Menu, setIcon } from 'obsidian';
import { t } from './i18n';
import type { ThreadTableRow } from './thread-table-data';
import { tableRootTrail } from './thread-table-breadcrumb-model';

export function renderTableRootBreadcrumb(parent: HTMLElement, rows: ThreadTableRow[], root: string, change: (root: string) => void): void {
	const nav = parent.createEl('nav', { cls: 'thread-journal-table-breadcrumbs', attr: { 'aria-label': t('Root thread') } });
	const trail = tableRootTrail(rows, root);
	for (const [i, crumb] of trail.entries()) {
		const button = nav.createEl('button', { text: crumb.title, attr: { type: 'button', title: crumb.title } });
		if (i === trail.length - 1) button.setAttribute('aria-current', 'location');
		button.addEventListener('click', () => change(crumb.id));
		if (!crumb.children.length) continue;
		const children = nav.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': `${crumb.title} · ${t('Child threads')}` } });
		setIcon(children, 'chevron-right');
		children.addEventListener('click', event => {
			const menu = new Menu();
			for (const child of crumb.children) menu.addItem(item => item.setTitle(child.title).setChecked(trail[i + 1]?.id === child.id).onClick(() => change(child.id)));
			menu.showAtMouseEvent(event);
		});
	}
}
