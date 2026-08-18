import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync('src/lib/components/AnimatedNumber.svelte', 'utf8');

describe('AnimatedNumber source contract', () => {
	it('keeps the final value accessible while animation frames stay visual only', () => {
		expect(component).toContain('aria-label={accessibleValue}');
		expect(component).toContain('aria-hidden="true"');
	});

	it('uses requestAnimationFrame and honors reduced motion', () => {
		expect(component).toContain('requestAnimationFrame');
		expect(component).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
	});
});
