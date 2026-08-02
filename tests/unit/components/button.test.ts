import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Button from '../../../src/lib/components/Button.svelte';

describe('Button', () => {
	it('defaults to a safe button type and renders its label', () => {
		const { body } = render(Button, { props: { label: 'Importar' } });

		expect(body).toContain('type="button"');
		expect(body).toContain('Importar');
	});

	it('exposes disabled state without changing the label', () => {
		const { body } = render(Button, { props: { label: 'Processando', disabled: true } });

		expect(body).toContain('disabled');
		expect(body).toContain('Processando');
	});
});
