export interface TimeSelectLabels {
	hour: string;
	minute: string;
}

export interface TimeSelectControl {
	setValue(value: string, notify?: boolean): void;
}

export function is24HourTime(value: string): boolean {
	const match = /^(\d{2}):(\d{2})$/u.exec(value);
	if (!match) return false;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function create24HourTimeSelect(
	container: HTMLElement,
	value: string,
	onChange: (value: string, incomplete: boolean) => void,
	labels: TimeSelectLabels,
	optional = false,
): TimeSelectControl {
	const wrapper = container.createSpan({ cls: 'thread-journal-time-select' });
	const hour = wrapper.createEl('select');
	hour.setAttribute('aria-label', labels.hour);
	const minute = wrapper.createEl('select');
	minute.setAttribute('aria-label', labels.minute);
	const addOption = (select: HTMLSelectElement, label: string, optionValue: string): void => {
		select.createEl('option', { text: label, attr: { value: optionValue } });
	};
	if (optional) {
		addOption(hour, '--', '');
		addOption(minute, '--', '');
	}
	for (let index = 0; index < 24; index += 1) {
		const text = String(index).padStart(2, '0');
		addOption(hour, text, text);
	}
	for (let index = 0; index < 60; index += 1) {
		const text = String(index).padStart(2, '0');
		addOption(minute, text, text);
	}
	wrapper.createSpan({ text: ':' });
	wrapper.appendChild(minute);

	const emit = (): void => {
		const hasHour = Boolean(hour.value);
		const hasMinute = Boolean(minute.value);
		onChange(hasHour && hasMinute ? `${hour.value}:${minute.value}` : '', hasHour !== hasMinute);
	};
	hour.addEventListener('change', emit);
	minute.addEventListener('change', emit);

	const setValue = (next: string, notify = false): void => {
		const valid = is24HourTime(next);
		hour.value = valid ? next.slice(0, 2) : optional ? '' : '00';
		minute.value = valid ? next.slice(3, 5) : optional ? '' : '00';
		if (notify) emit();
	};
	setValue(value, true);
	return { setValue };
}
