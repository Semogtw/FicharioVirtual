import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const UNIT_PATH = 'packaging/systemd/fichario-ocr-worker-safe.service';
const INSTALLER_PATH = 'tools/desktop-worker/install-user-service-safe.sh';

describe('desktop worker writable hardened service', () => {
	it('protects system paths without making the user state hierarchy read-only', async () => {
		const unit = await readFile(UNIT_PATH, 'utf8');
		expect(unit).toContain('ProtectSystem=full');
		expect(unit).not.toContain('ProtectSystem=strict');
		expect(unit).toContain('NoNewPrivileges=true');
		expect(unit).toContain('PrivateTmp=true');
		expect(unit).toContain('CapabilityBoundingSet=\n');
		expect(unit).toContain('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6');
	});

	it('installs the corrected unit under the canonical user service name', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain(
			'unit_source="$repo_root/packaging/systemd/fichario-ocr-worker-safe.service"'
		);
		expect(installer).toContain('unit_path="$unit_dir/fichario-ocr-worker.service"');
		expect(installer).toContain('install -m 0600 "$unit_source" "$unit_path"');
	});

	it('includes pair and unpair commands but never starts the service automatically', async () => {
		const installer = await readFile(INSTALLER_PATH, 'utf8');
		expect(installer).toContain('$bin_dir/fichario-worker-pair');
		expect(installer).toContain('$bin_dir/fichario-worker-unpair');
		expect(installer).toContain('systemctl --user daemon-reload');
		expect(installer).not.toMatch(/^\s*systemctl --user (?:enable|start|restart)\b/m);
	});
});
