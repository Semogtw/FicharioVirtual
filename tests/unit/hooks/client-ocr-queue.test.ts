import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const hook = readFileSync(new URL('src/hooks.client.ts', repositoryRoot), 'utf8');
const session = readFileSync(new URL('src/lib/stores/session.svelte.ts', repositoryRoot), 'utf8');

describe('client OCR queue lifecycle', () => {
	it('resumes after authorization and pauses after session loss', () => {
		expect(hook).toContain("import { pauseQueue, resumeQueue } from '$lib/import/job-runner';");
		expect(hook).toContain('subscribeSessionAuthorization((authorized) => {');
		expect(hook).toContain('if (authorized) void resumeQueue();');
		expect(hook).toContain('else pauseQueue();');
		expect(session).toContain('export function subscribeSessionAuthorization(');
		expect(session).toContain('authorizationListeners');
	});
});
