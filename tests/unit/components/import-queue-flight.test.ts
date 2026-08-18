import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/lib/components/AppShell.svelte', 'utf8');
const flight = readFileSync('src/lib/components/ImportQueueFlight.svelte', 'utf8');

describe('import queue motion feedback', () => {
	it('mounts one global import-to-queue feedback layer', () => {
		expect(shell).toContain("import ImportQueueFlight from './ImportQueueFlight.svelte';");
		expect(shell).toContain('<ImportQueueFlight />');
	});

	it('only launches after a recent import-page interaction adds queue items', () => {
		expect(flight).toContain("document.addEventListener('change', captureFileSelection, true)");
		expect(flight).toContain("document.addEventListener('drop', captureDrop, true)");
		expect(flight).toContain("document.addEventListener('click', captureQueueAction, true)");
		expect(flight).toContain('performance.now() - origin.at > ORIGIN_TTL_MS');
		expect(flight).toContain('const added = total - observedCount;');
		expect(flight).toContain('if (added > 0 && isImportRoute()) launchFlight(added);');
	});

	it('animates toward the existing queue trigger and gives it arrival feedback', () => {
		expect(flight).toContain("document.querySelector<HTMLElement>('.queue-trigger')");
		expect(flight).toContain("target.classList.add('queue-arrival')");
		expect(flight).toContain('@keyframes queue-flight');
		expect(flight).toContain('@keyframes queue-arrival-pop');
	});

	it('also polishes abrupt import and queue interactions without replacing semantics', () => {
		expect(flight).toContain(':global(.queue-panel)');
		expect(flight).toContain(':global(main .drop-zone.dragging)');
		expect(flight).toContain(':global(main .photo-card-actions button:first-child)');
		expect(flight).toContain(':global(main .selection-message)');
	});
});
