import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync('src/lib/design/global.css', 'utf8');

describe('reduced motion accessibility', () => {
	it('disables non-essential animation and transition motion when requested', () => {
		expect(globalCss).toContain('@media (prefers-reduced-motion: reduce)');
		expect(globalCss).toContain('animation-duration: 0.01ms');
		expect(globalCss).toContain('animation-iteration-count: 1');
		expect(globalCss).toContain('transition-duration: 0.01ms');
		expect(globalCss).toContain('scroll-behavior: auto');
	});
});
