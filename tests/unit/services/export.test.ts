import { describe, expect, it } from 'vitest';
import type { ExportManifest } from '../../../src/lib/export/manifest';
import {
	createPortableExport,
	serializePortableExport,
	type ExportClientLike
} from '../../../src/lib/services/export';

const manifest: ExportManifest = {
	schemaVersion: 1,
	exportedAt: '2026-08-02T06:07:08.000Z',
	notebooks: [],
	documents: []
};

describe('portable export service', () => {
	it('validates the RPC payload before returning it', async () => {
		const client: ExportClientLike = {
			async rpc() {
				return { data: manifest, error: null };
			}
		};
		await expect(createPortableExport(client)).resolves.toEqual(manifest);
	});

	it('serializes readable UTF-8 JSON with a trailing newline', () => {
		const serialized = serializePortableExport(manifest);
		expect(serialized).toContain('"schemaVersion": 1');
		expect(serialized.endsWith('\n')).toBe(true);
	});

	it('does not pass through malformed backend data', async () => {
		const client: ExportClientLike = {
			async rpc() {
				return { data: { schemaVersion: 2 }, error: null };
			}
		};
		await expect(createPortableExport(client)).rejects.toThrow('Invalid export manifest');
	});
});
