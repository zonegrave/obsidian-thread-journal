import { setIcon } from 'obsidian';
import { t } from './i18n';
import { moveCommitOption } from './commit-option-model';

export function createCommitOptionEditor(
	container: HTMLElement,
	initialOptions: readonly string[],
	onChange: (options: string[]) => void,
): void {
	let options = [...initialOptions];
	let draggedIndex: number | undefined;
	const editor = container.createDiv({ cls: 'thread-journal-commit-option-editor' });
	const list = editor.createDiv({ cls: 'thread-journal-commit-option-list' });

	const committedOptions = (): string[] => options
		.map((option) => option.trim())
		.filter(Boolean);
	const commit = (): void => onChange(committedOptions());
	const move = (from: number, to: number): void => {
		if (from === to) return;
		options = moveCommitOption(options, from, to);
		commit();
		render(to);
	};

	const render = (focusIndex?: number): void => {
		list.empty();
		options.forEach((option, index) => {
			const row = list.createDiv({ cls: 'thread-journal-commit-option-row' });
			const drag = row.createEl('button', {
				cls: 'thread-journal-commit-option-drag',
				attr: {
					type: 'button',
					'aria-label': t('Drag to reorder option'),
					draggable: 'true',
				},
			});
			setIcon(drag, 'grip-vertical');
			drag.addEventListener('dragstart', (event) => {
				draggedIndex = index;
				row.classList.add('is-dragging');
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = 'move';
					event.dataTransfer.setData('text/plain', String(index));
				}
			});
			drag.addEventListener('dragend', () => {
				draggedIndex = undefined;
				row.classList.remove('is-dragging');
				list.querySelectorAll('.is-drop-target').forEach((element) => {
					element.classList.remove('is-drop-target');
				});
			});
			drag.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
				if (target >= 0 && target < options.length) move(index, target);
			});

			row.addEventListener('dragover', (event) => {
				if (draggedIndex === undefined || draggedIndex === index) return;
				event.preventDefault();
				row.classList.add('is-drop-target');
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
			});
			row.addEventListener('dragleave', () => {
				row.classList.remove('is-drop-target');
			});
			row.addEventListener('drop', (event) => {
				event.preventDefault();
				row.classList.remove('is-drop-target');
				if (draggedIndex === undefined) return;
				move(draggedIndex, index);
				draggedIndex = undefined;
			});

			const input = row.createEl('input', {
				cls: 'thread-journal-commit-option-input',
				attr: {
					type: 'text',
					'aria-label': t('Option'),
					placeholder: t('Option'),
				},
			});
			input.value = option;
			input.addEventListener('input', () => {
				options[index] = input.value;
				commit();
			});
			input.addEventListener('blur', () => {
				const trimmed = input.value.trim();
				if (!trimmed) {
					options.splice(index, 1);
					commit();
					render();
					return;
				}
				options[index] = trimmed;
				input.value = trimmed;
				commit();
			});

			const remove = row.createEl('button', {
				cls: 'thread-journal-commit-option-delete',
				attr: { type: 'button', 'aria-label': t('Delete option') },
			});
			setIcon(remove, 'x');
			remove.addEventListener('click', () => {
				options.splice(index, 1);
				commit();
				render(Math.min(index, options.length - 1));
			});

			if (focusIndex === index) window.setTimeout(() => input.focus(), 0);
		});
	};

	const add = editor.createEl('button', {
		cls: 'thread-journal-commit-option-add',
		attr: { type: 'button', 'aria-label': t('Add option') },
	});
	setIcon(add, 'plus');
	add.addEventListener('click', () => {
		options.push('');
		render(options.length - 1);
	});
	render();
}
