import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { taskScheduledLabel, type TaskData } from './task-model';
import { taskNextActionLabel, taskRepeatRuleDisplay } from './task-display';

// Scheduling is primary; a repeat rule only changes what the calendar button does.
export function renderTaskSchedule(parent: HTMLElement, data: TaskData, today: string,
	onNext: () => void | Promise<void>): void {
	if (!data.scheduled) return;
	const label = taskScheduledLabel(data.scheduled, today, t('Today'));
	const overdue = data.scheduled < today && !['completed', 'cancelled'].includes(data.status);
	const title = data.repeat ? `${taskRepeatRuleDisplay(data)} · ${taskNextActionLabel(data, today)}` : t('Scheduled date');
	const schedule = parent.createSpan({ cls: `thread-journal-task-schedule${overdue ? ' is-overdue' : ''}`, attr: { title } });
	const icon: HTMLElement = schedule.createEl(data.repeat ? 'button' : 'span', {
		cls: data.repeat ? 'clickable-icon thread-journal-task-schedule-next' : 'thread-journal-task-chip-icon',
		attr: { 'aria-label': title },
	});
	setIcon(icon, 'calendar-check');
	if (data.repeat) {
		icon.setAttribute('type', 'button');
		icon.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
		icon.addEventListener('click', event => {
			event.preventDefault(); event.stopPropagation();
			const button = icon as HTMLButtonElement;
			button.disabled = true;
			void Promise.resolve().then(onNext).catch((error: unknown) => {
				new Notice(t('Failed to move task to next: {error}', { error: String(error) }));
			}).finally(() => { if (button.isConnected) button.disabled = false; });
		});
	}
	schedule.createSpan({ text: overdue ? `${label} · ${t('Overdue')}` : label });
}
