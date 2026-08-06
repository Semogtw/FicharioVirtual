import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cardPath = 'src/lib/components/DriveConnectionCard.svelte';
const settingsPath = 'src/routes/settings/+page.svelte';

describe('Drive connection settings', () => {
	it('loads and presents connection state without browser token persistence', () => {
		const card = readFileSync(cardPath, 'utf8');

		expect(card).toContain('driveConnectionPresentation');
		expect(card).toContain('loadDriveConnection');
		expect(card).toContain('beginDriveConnection');
		expect(card).toContain('isDriveOAuthConfigured');
		expect(card).toContain('aria-live="polite"');
		expect(card).toContain("window.location.assign(authorizationUrl)");
		expect(card).not.toContain('localStorage');
		expect(card).not.toContain('sessionStorage');
		expect(card).not.toContain('refresh_token');
		expect(card).not.toContain('access_token');
	});

	it('places the Drive connection card in Settings before exports', () => {
		const settings = readFileSync(settingsPath, 'utf8');

		expect(settings).toContain(
			"import DriveConnectionCard from '$lib/components/DriveConnectionCard.svelte';"
		);
		expect(settings).toContain('<DriveConnectionCard />');
		expect(settings.indexOf('<DriveConnectionCard />')).toBeLessThan(
			settings.indexOf('Exportação portátil')
		);
	});
});
