import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const INSTALLER_PATH = 'tools/desktop-worker/install-user-service-v2.sh';

describe('desktop worker complete user installer', () => {
	it('installs all setup and lifecycle commands without starting the service', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		for (const command of [
			'fichario-worker-config',
			'fichario-worker-model',
			'fichario-worker-pair',
			'fichario-worker-unpair',
			'fichario-worker-status',
			'fichario-worker'
		]) {
			expect(installer).toContain(`$bin_dir/${command}`);
		}
		expect(installer).toContain('systemctl --user daemon-reload');
		expect(installer).not.toMatch(/^\s*systemctl --user (?:enable|start|restart)\b/m);
	});

	it('installs only user-owned private runtime files and never elevates privileges', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain('install -d -m 0700 "$install_dir"');
		expect(installer).toContain('install -m 0600 "$module"');
		expect(installer).toContain('chmod 0700');
		expect(installer).not.toMatch(/^\s*(?:sudo|doas)\b/m);
		expect(installer).not.toMatch(/^\s*(?:pacman|apt|dnf|zypper)\b/m);
	});

	it('warns about a missing Secret Service client instead of silently weakening credential storage', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain('[[ ! -x /usr/bin/secret-tool ]]');
		expect(installer).toContain('install libsecret before pairing');
	});
});
