import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const confirmDialog = readFileSync('src/lib/components/ConfirmDialog.svelte', 'utf8');
const textInputDialog = readFileSync('src/lib/components/TextInputDialog.svelte', 'utf8');

describe('modal accessibility contract', () => {
	it('keeps destructive confirmation focus inside the modal and restores it on close', () => {
		expect(confirmDialog).toContain('aria-modal="true"');
		expect(confirmDialog).toContain('tabindex="-1"');
		expect(confirmDialog).toContain('previouslyFocused');
		expect(confirmDialog).toContain('trapFocus');
		expect(confirmDialog).toContain('cancelButton?.focus');
	});

	it('exposes text editing dialogs with a labelled dialog and focus management', () => {
		expect(textInputDialog).toContain('role="dialog"');
		expect(textInputDialog).toContain(
			"aria-describedby={description ? 'text-dialog-description' : undefined}"
		);
		expect(textInputDialog).toContain('input)?.focus');
		expect(textInputDialog).toContain('trapFocus');
	});
});
