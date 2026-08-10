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

	it('installs executable shims for config, model setup, pairing, and service', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		for (const entrypoint of ['bin.mjs', 'config-bin.mjs', 'pair-bin.mjs', 'model-bin.mjs']) {
			expect(installer).toContain(`"$install_dir/${entrypoint}"`);
		}
		expect(installer).toContain(
			'ln -sfn ../lib/fichario-worker/bin.mjs "$bin_dir/fichario-worker"'
		);
		expect(installer).toContain(
			'ln -sfn ../lib/fichario-worker/config-bin.mjs "$bin_dir/fichario-worker-config"'
		);
		expect(installer).toContain(
			'ln -sfn ../lib/fichario-worker/pair-bin.mjs "$bin_dir/fichario-worker-pair"'
		);
		expect(installer).toContain(
			'ln -sfn ../lib/fichario-worker/model-bin.mjs "$bin_dir/fichario-worker-model"'
		);
	});

	it('requires Node 22+ and never elevates privileges or invokes a package manager', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain('(( node_major >= 22 ))');
		expect(installer).not.toMatch(/^\s*(?:sudo|doas)\b/m);
		expect(installer).not.toMatch(/^\s*(?:pacman|apt|dnf|zypper)\b/m);
	});
});
