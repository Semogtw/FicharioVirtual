import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/InstallAppButton.svelte', 'utf8');

describe('InstallAppButton lifecycle', () => {
	it('does not publish an install result after the component is destroyed', () => {
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const installRequests = new RequestVersion();');
		expect(source).toContain('const version = installRequests.next();');
		expect(source).toContain('const event = promptEvent;');
		expect(source).toMatch(
			/await event\.prompt\(\);[\s\S]*const choice = await event\.userChoice;[\s\S]*if \(!installRequests\.isCurrent\(version\)\) return;[\s\S]*choice\.outcome === 'accepted'/
		);
		expect(source).toMatch(/onDestroy\(\(\) => \{[\s\S]*installRequests\.next\(\);[\s\S]*\}\);/);
	});

	it('consumes the browser prompt once and handles prompt failures', () => {
		expect(source).toMatch(
			/const event = promptEvent;[\s\S]*promptEvent = null;[\s\S]*try \{[\s\S]*await event\.prompt\(\);/
		);
		expect(source).toMatch(
			/catch \{[\s\S]*if \(!installRequests\.isCurrent\(version\)\) return;[\s\S]*message = 'Não foi possível abrir a instalação do aplicativo\.';/
		);
	});
});
