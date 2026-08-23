import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('native Linux sync timer', () => {
	it('runs the installed desktop binary in bounded one-shot mode', async () => {
		const service = await readFile('packaging/systemd/fichario-native-sync.service', 'utf8');
		expect(service).toContain('Type=oneshot');
		expect(service).toContain('ExecStart=/usr/bin/fichario-native --sync-once');
		expect(service).toContain('NoNewPrivileges=true');
		expect(service).toContain('ProtectHome=false');
	});

	it('fires after boot and periodically while the user session is available', async () => {
		const timer = await readFile('packaging/systemd/fichario-native-sync.timer', 'utf8');
		expect(timer).toContain('OnBootSec=5min');
		expect(timer).toContain('OnUnitActiveSec=15min');
		expect(timer).toContain('Persistent=true');
		expect(timer).toContain('Unit=fichario-native-sync.service');
	});
});
