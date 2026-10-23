import { t } from './i18n';

// A DOM popup avoids native select menus losing focus inside Obsidian modals.
export function renderTaskHourPicker(parent: HTMLElement, layer: HTMLElement, initial: string, onChange: (hour: string) => void): {
	dispose: () => void; closeMenu: () => boolean;
} {
	const doc = parent.ownerDocument;
	const win = doc.defaultView ?? window;
	let value = initial;
	let menu: HTMLElement | undefined;
	const row = parent.createDiv({ cls: 'thread-journal-task-scheduled-hour' });
	row.createSpan({ text: t('Hour') });
	const trigger = row.createEl('button', { cls: 'thread-journal-task-hour-trigger', attr: {
		type: 'button', 'aria-label': t('Scheduled hour'), 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
	} });
	const update = (): void => { trigger.setText(value ? `${value}:00` : '--'); trigger.title = value ? `${value}:00` : t('All day'); };
	update();
	const position = (): void => {
		if (!menu) return;
		const bounds = trigger.getBoundingClientRect();
		menu.style.left = `${Math.max(8, Math.min(bounds.left, win.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.maxHeight = `${Math.max(40, Math.min(180, Math.max(win.innerHeight - bounds.bottom - 12, bounds.top - 12)))}px`;
		menu.style.top = `${bounds.bottom + menu.offsetHeight + 4 <= win.innerHeight - 8 ? bounds.bottom + 4 : Math.max(8, bounds.top - menu.offsetHeight - 4)}px`;
	};
	const closeMenu = (): boolean => {
		if (!menu) return false;
		menu.remove(); menu = undefined;
		trigger.setAttribute('aria-expanded', 'false');
		doc.removeEventListener('pointerdown', outside, true);
		doc.removeEventListener('scroll', position, true);
		win.removeEventListener('resize', position);
		return true;
	};
	const outside = (event: PointerEvent): void => {
		if (event.target instanceof Node && !menu?.contains(event.target) && !trigger.contains(event.target)) closeMenu();
	};
	const open = (): void => {
		if (closeMenu()) return;
		menu = layer.createDiv({ cls: 'thread-journal-task-hour-menu', attr: { role: 'listbox', 'aria-label': t('Scheduled hour') } });
		trigger.setAttribute('aria-expanded', 'true');
		let selected: HTMLElement | undefined;
		for (const hour of ['', ...Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))]) {
			const option = menu.createEl('button', { text: hour ? `${hour}:00` : '--', attr: {
				type: 'button', role: 'option', 'aria-selected': String(hour === value), title: hour ? `${hour}:00` : t('All day'),
			} });
			if (hour === value) selected = option;
			option.addEventListener('mousedown', event => event.preventDefault());
			option.addEventListener('click', () => { value = hour; update(); closeMenu(); onChange(value); });
		}
		position();
		if (selected) menu.scrollTop = Math.max(0, selected.offsetTop - menu.clientHeight / 2 + selected.offsetHeight / 2);
		doc.addEventListener('pointerdown', outside, true);
		doc.addEventListener('scroll', position, true);
		win.addEventListener('resize', position);
	};
	trigger.addEventListener('mousedown', event => event.preventDefault());
	trigger.addEventListener('click', open);
	return { dispose: () => { closeMenu(); trigger.removeEventListener('click', open); }, closeMenu };
}
