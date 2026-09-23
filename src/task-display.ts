import { moment } from 'obsidian';
import { t, type TranslationKey } from './i18n';
import {
	advanceTaskData,
	taskRepeatLabel,
	taskWindowState,
	type TaskData,
	type TaskEffort,
} from './task-model';

export const TASK_EFFORT_LABELS: Record<Exclude<TaskEffort, ''>, TranslationKey> = {
	quick: 'Quick',
	light: 'Light',
	normal: 'Normal effort',
	deep: 'Deep',
};

export function taskRepeatRuleDisplay(data: TaskData): string {
	const label = taskRepeatLabel(data);
	if (label === 'Daily') return t('Daily');
	if (label === 'Weekly') return t('Weekly');
	if (label === 'Monthly') return t('Monthly');
	return t('Every {count} days', { count: data.repeatInterval });
}

export function taskNextActionLabel(data: TaskData, today: string): string {
	const next = advanceTaskData(data, today)?.current;
	return next ? t('To next: {date}', { date: next }) : t('To next');
}

export function taskDeadlineDisplay(
	data: Pick<TaskData, 'windowStart' | 'windowEnd'>,
	today: string,
): { label: string; modifier: string } | undefined {
	const current = moment(today, 'YYYY-MM-DD', true).startOf('day');
	if (!current.isValid()) return undefined;
	if (data.windowStart) {
		const start = moment(data.windowStart, 'YYYY-MM-DD', true).startOf('day');
		if (start.isValid() && start.isAfter(current)) {
			return { label: t('Not started'), modifier: 'upcoming' };
		}
	}
	if (!data.windowEnd) return undefined;
	const end = moment(data.windowEnd, 'YYYY-MM-DD', true).startOf('day');
	if (!end.isValid()) return undefined;
	const days = end.diff(current, 'days');
	if (days < 0) {
		return { label: t('{count}d overdue', { count: Math.abs(days) }), modifier: 'overdue' };
	}
	if (days === 0) return { label: t('Due today'), modifier: 'current' };
	if (days > 30) return { label: '30d+', modifier: 'distant' };
	return {
		label: t('{count}d left', { count: days }),
		modifier: taskWindowState(data, today) ?? 'current',
	};
}
