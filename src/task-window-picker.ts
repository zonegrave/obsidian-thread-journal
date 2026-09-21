import { moment, setIcon } from 'obsidian';
import { t } from './i18n';

type WindowSide = 'start' | 'end';

function validDate(value: string): boolean {
	return moment(value, 'YYYY-MM-DD', true).isValid();
}

class TaskWindowPopover {
	private readonly popover: HTMLElement;
	private readonly doc: Document;
	private readonly win: Window;
	private draftStart: string;
	private draftEnd: string;
	private startMonth = moment().startOf('month');
	private endMonth = moment().add(1, 'month').startOf('month');
	private closed = false;

	constructor(
		private readonly trigger: HTMLElement,
		start: string,
		end: string,
		private readonly onApply: (start: string, end: string) => void,
		private readonly onClose: () => void,
	) {
		this.doc = trigger.ownerDocument;
		this.win = this.doc.defaultView ?? window;
		this.draftStart = start;
		this.draftEnd = end;
		this.startMonth = moment(validDate(start) ? start : undefined).startOf('month');
		this.endMonth = moment(
			validDate(end) ? end : this.startMonth.clone().add(1, 'month'),
		).startOf('month');
		this.popover = this.doc.body.createDiv({ cls: 'thread-journal-task-window-popover' });
		this.render();
		this.doc.addEventListener('pointerdown', this.handleOutsidePointer, true);
		this.doc.addEventListener('keydown', this.handleKeydown, true);
		this.doc.addEventListener('scroll', this.position, true);
		this.win.addEventListener('resize', this.position);
	}

	private readonly handleOutsidePointer = (event: PointerEvent): void => {
		const target = event.target as Node | null;
		if (!target) return;
		if (this.popover.contains(target) || this.trigger.contains(target)) return;
		this.close();
	};

	private readonly handleKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		this.close();
	};

	private readonly position = (): void => {
		if (this.closed) return;
		const margin = 8;
		const gap = 6;
		const triggerRect = this.trigger.getBoundingClientRect();
		const width = Math.min(720, this.win.innerWidth - margin * 2);
		this.popover.style.width = `${width}px`;
		const popoverRect = this.popover.getBoundingClientRect();
		const left = Math.min(
			Math.max(margin, triggerRect.left),
			Math.max(margin, this.win.innerWidth - width - margin),
		);
		const below = triggerRect.bottom + gap;
		const above = triggerRect.top - popoverRect.height - gap;
		const top = below + popoverRect.height <= this.win.innerHeight - margin
			? below
			: Math.max(margin, above);
		this.popover.style.left = `${left}px`;
		this.popover.style.top = `${top}px`;
	};

	private render(): void {
		this.popover.empty();
		this.popover.createDiv({
			cls: 'thread-journal-task-window-popover-title',
			text: t('Select task window'),
		});
		const calendars = this.popover.createDiv({
			cls: 'thread-journal-task-window-calendars',
		});
		this.renderCalendar(calendars, 'start');
		this.renderCalendar(calendars, 'end');

		const actions = this.popover.createDiv({ cls: 'thread-journal-task-window-actions' });
		actions.createEl('button', {
			text: t('Clear'),
			attr: { type: 'button' },
		}).addEventListener('click', () => {
			this.draftStart = '';
			this.draftEnd = '';
			this.render();
		});
		actions.createEl('button', {
			text: t('Cancel'),
			attr: { type: 'button' },
		}).addEventListener('click', () => this.close());
		actions.createEl('button', {
			cls: 'mod-cta',
			text: t('Apply'),
			attr: { type: 'button' },
		}).addEventListener('click', () => {
			this.onApply(this.draftStart, this.draftEnd);
			this.close();
		});
		this.position();
	}

	private renderCalendar(parent: HTMLElement, side: WindowSide): void {
		const month = side === 'start' ? this.startMonth : this.endMonth;
		const selected = side === 'start' ? this.draftStart : this.draftEnd;
		const pane = parent.createDiv({
			cls: `thread-journal-task-window-pane is-${side}`,
		});
		const paneTitle = pane.createDiv({ cls: 'thread-journal-task-window-pane-title' });
		paneTitle.createSpan({ text: t(side === 'start' ? 'Start date' : 'End date') });
		if (selected) paneTitle.createSpan({
			cls: 'thread-journal-task-window-value',
			text: selected,
		});
		const clear = paneTitle.createEl('button', {
			cls: 'clickable-icon',
			attr: {
				type: 'button',
				'aria-label': t(side === 'start' ? 'Clear start date' : 'Clear end date'),
			},
		});
		setIcon(clear, 'x');
		clear.disabled = !selected;
		clear.addEventListener('click', () => {
			if (side === 'start') this.draftStart = '';
			else this.draftEnd = '';
			this.render();
		});

		const header = pane.createDiv({ cls: 'thread-journal-task-window-picker-header' });
		const previous = header.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': t('Previous month') },
		});
		setIcon(previous, 'chevron-left');
		header.createDiv({
			cls: 'thread-journal-task-window-picker-month',
			text: month.format('YYYY MMMM'),
		});
		const next = header.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': t('Next month') },
		});
		setIcon(next, 'chevron-right');
		previous.addEventListener('click', () => {
			if (side === 'start') this.startMonth = this.startMonth.clone().subtract(1, 'month');
			else this.endMonth = this.endMonth.clone().subtract(1, 'month');
			this.render();
		});
		next.addEventListener('click', () => {
			if (side === 'start') this.startMonth = this.startMonth.clone().add(1, 'month');
			else this.endMonth = this.endMonth.clone().add(1, 'month');
			this.render();
		});

		const calendar = pane.createDiv({ cls: 'thread-journal-task-window-calendar' });
		for (const weekday of moment.weekdaysMin(true)) {
			calendar.createDiv({ cls: 'thread-journal-task-window-weekday', text: weekday });
		}
		const day = month.clone().startOf('month').startOf('week');
		const today = moment().format('YYYY-MM-DD');
		for (let index = 0; index < 42; index += 1) {
			const value = day.format('YYYY-MM-DD');
			const classes = ['thread-journal-task-window-day'];
			if (day.month() !== month.month()) classes.push('is-outside');
			if (value === today) classes.push('is-today');
			if (value === this.draftStart) classes.push('is-start');
			if (value === this.draftEnd) classes.push('is-end');
			if (this.draftStart && this.draftEnd
				&& value > this.draftStart && value < this.draftEnd) {
				classes.push('is-between');
			}
			const button = calendar.createEl('button', {
				cls: classes.join(' '),
				text: day.format('D'),
				attr: { type: 'button', 'aria-label': value },
			});
			button.disabled = side === 'end' && Boolean(this.draftStart) && value < this.draftStart;
			button.addEventListener('click', () => {
				if (side === 'start') {
					this.draftStart = value;
					if (this.draftEnd && this.draftEnd < value) this.draftEnd = '';
					if (this.endMonth.clone().endOf('month').format('YYYY-MM-DD') < value) {
						this.endMonth = moment(value, 'YYYY-MM-DD').startOf('month');
					}
				} else {
					this.draftEnd = value;
				}
				this.render();
			});
			day.add(1, 'day');
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.doc.removeEventListener('pointerdown', this.handleOutsidePointer, true);
		this.doc.removeEventListener('keydown', this.handleKeydown, true);
		this.doc.removeEventListener('scroll', this.position, true);
		this.win.removeEventListener('resize', this.position);
		this.popover.remove();
		this.onClose();
	}
}

export function openTaskWindowPicker(
	trigger: HTMLElement,
	start: string,
	end: string,
	onApply: (start: string, end: string) => void,
	onClose: () => void,
): () => void {
	const popover = new TaskWindowPopover(trigger, start, end, onApply, onClose);
	return () => popover.close();
}
