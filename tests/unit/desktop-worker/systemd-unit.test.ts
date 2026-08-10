import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const UNIT_PATH = 'packaging/systemd/fichario-ocr-worker.service';

describe('desktop worker systemd unit', () => {
	it('runs the local entrypoint with restrictive defaults while keeping user state writable', async () => {
		const unit = await readFile(UNIT_PATH, 'utf8');
		expect(unit).toContain('ExecStart=/usr/bin/env node %h/.local/lib/fichario-worker/bin.mjs');
		expect(unit).toContain('UMask=0077');
		expect(unit).toContain('NoNewPrivileges=true');
		expect(unit).toContain('PrivateTmp=true');
		expect(unit).toContain('ProtectSystem=full');
		expect(unit).toContain('ProtectHome=false');
		expect(unit).not.toContain('ProtectSystem=strict');
		expect(unit).toContain('CapabilityBoundingSet=\n');
		expect(unit).toContain('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6');
	});

	it('does not use systemd environment injection for runtime state', async () => {
		const unit = await readFile(UNIT_PATH, 'utf8');
		expect(unit).not.toMatch(/Environment(File)?=/);
	});
});
