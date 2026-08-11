import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const INSTALLER_PATH = 'tools/desktop-worker/install-user-service.sh';

describe('desktop worker user service installer', () => {
	it('copies worker and unit files privately then only reloads the user manager', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain('install -d -m 0700 "$install_dir"');
		expect(installer).toContain('install -m 0600 "$module"');
		expect(installer).toContain('install -m 0600 "$unit_source" "$unit_path"');
		expect(installer).toContain('systemctl --user daemon-reload');
		expect(installer).not.toMatch(/^\s*systemctl --user (?:enable|start|restart)\b/m);
	});

	it('installs only the launch setup and lifecycle commands', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		for (const entrypoint of [
			'bin.mjs',
			'config-bin.mjs',
			'pair-code-bin.mjs',
			'forget-bin.mjs',
			'model-bin.mjs',
			'status-bin.mjs'
		]) {
			expect(installer).toContain(`"$install_dir/${entrypoint}"`);
		}
		for (const command of [
			'fichario-worker',
			'fichario-worker-config',
			'fichario-worker-pair-code',
			'fichario-worker-forget',
			'fichario-worker-model',
			'fichario-worker-status'
		]) {
			expect(installer).toContain(`$bin_dir/${command}`);
		}
		expect(installer).not.toContain('fichario-worker-pair"');
		expect(installer).not.toContain('fichario-worker-unpair');
	});

	it('requires Node 22+ and never elevates privileges or invokes a package manager', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain('(( node_major >= 22 ))');
		expect(installer).not.toMatch(/^\s*(?:sudo|doas)\b/m);
		expect(installer).not.toMatch(/^\s*(?:pacman|apt|dnf|zypper)\b/m);
	});

	it('requires Secret Service instead of weakening credential storage', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain('[[ ! -x /usr/bin/secret-tool ]]');
		expect(installer).toContain('install libsecret before pairing');
	});
});
