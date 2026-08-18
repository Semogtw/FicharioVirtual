import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/lib/components/AppShell.svelte', 'utf8');
const card = readFileSync('src/lib/components/DocumentCard.svelte', 'utf8');
const animatedNumber = readFileSync('src/lib/components/AnimatedNumber.svelte', 'utf8');
const queue = readFileSync('src/lib/components/ImportQueueTray.svelte', 'utf8');
const home = readFileSync('src/routes/+page.svelte', 'utf8');
const globalCss = readFileSync('src/lib/design/global.css', 'utf8');

describe('premium continuity motion', () => {
	it('uses progressive view transitions with a document-card shared surface', () => {
		expect(shell).toContain('onNavigate');
		expect(shell).toContain('startViewTransition');
		expect(shell).toContain('class:document-route={documentRoute}');
		expect(shell).toContain('view-transition-name: selected-document');
		expect(card).toContain("card.dataset.documentTransition = 'selected'");
		expect(card).toContain('view-transition-name: selected-document');
		expect(globalCss).toContain('::view-transition-group(selected-document)');
		expect(globalCss).toContain('html:active-view-transition .route-content');
	});

	it('animates dashboard values without repeatedly announcing intermediate frames', () => {
		expect(animatedNumber).toContain('requestAnimationFrame');
		expect(animatedNumber).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
		expect(animatedNumber).toContain('aria-label={accessibleValue}');
		expect(animatedNumber).toContain('aria-hidden="true"');
		expect(home).toContain('<AnimatedNumber value={usage?.totals.documents ?? null} />');
		expect(home).toContain('<AnimatedNumber value={usage?.totals.pages ?? null} />');
		expect(home).toContain('<AnimatedNumber value={usage?.totals.reviewPages ?? null} />');
	});

	it('gives transient panels both entrance and exit motion', () => {
		expect(home).toContain("import { fly } from 'svelte/transition';");
		expect(home.match(/transition:fly=\{\{ y: -6, duration: 220 \}\}/g)?.length).toBeGreaterThanOrEqual(
			3
		);
		expect(queue).toContain("import { fly } from 'svelte/transition';");
		expect(queue).toContain('transition:fly={{ y: -8, duration: 220 }}');
	});

	it('keeps view transitions inside the reduced-motion opt-out', () => {
		expect(globalCss).toContain('::view-transition-group(*)');
		expect(globalCss).toContain('::view-transition-old(*)');
		expect(globalCss).toContain('::view-transition-new(*)');
		expect(globalCss).toContain('animation-duration: 0.01ms !important');
	});
});
