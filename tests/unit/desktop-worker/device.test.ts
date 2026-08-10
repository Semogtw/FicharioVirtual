import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	loadDeviceMetadata,
	parseDeviceMetadata,
	parseWorkerEndpoint,
	saveDeviceMetadata
} from '../../../tools/desktop-worker/device.mjs';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-worker';
const roots: string[] = [];

async function root() {
	const path = await mkdtemp(join(tmpdir(), 'fichario-worker-device-'));
	roots.push(path);
	return path;
}

function metadata(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		deviceId: DEVICE_ID,
		label: 'Desktop principal',
		workerEndpoint: ENDPOINT,
		createdAt: '2026-08-10T02:00:00.000Z',
		...overrides
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('desktop worker device metadata', () => {
	it('persists only the strict non-secret shape in a private file', async () => {
		const directory = await root();
		const path = join(directory, 'device.json');

		await saveDeviceMetadata(path, metadata());
		const loaded = await loadDeviceMetadata(path);

		expect(loaded).toEqual(metadata());
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		const raw = await readFile(path, 'utf8');
		expect(raw).toContain(DEVICE_ID);
		expect(raw).toContain(ENDPOINT);
		expect(raw.toLowerCase()).not.toContain('credential');
		expect(raw.toLowerCase()).not.toContain('token');
	});

	it('rejects any widened metadata shape so credentials cannot be added accidentally', () => {
		expect(() =>
			parseDeviceMetadata({
				...metadata(),
				credential: 'A'.repeat(43)
			})
		).toThrow('metadata shape');
		expect(() =>
			parseDeviceMetadata({
				...metadata(),
				accessToken: 'browser-jwt'
			})
		).toThrow('metadata shape');
	});

	it('requires the exact HTTPS desktop worker Edge Function path', () => {
		expect(parseWorkerEndpoint(ENDPOINT)).toBe(`${ENDPOINT}/`.replace('/desktop-ocr-worker/', '/desktop-ocr-worker'));
		expect(() => parseWorkerEndpoint('http://example.com/functions/v1/desktop-ocr-worker')).toThrow(
			'endpoint'
		);
		expect(() =>
			parseWorkerEndpoint('https://user:pass@example.com/functions/v1/desktop-ocr-worker')
		).toThrow('endpoint');
		expect(() =>
			parseWorkerEndpoint('https://example.com/functions/v1/desktop-ocr-worker?token=secret')
		).toThrow('endpoint');
	});

	it('rejects malformed ids, labels, timestamps and unknown schema versions', () => {
		expect(() => parseDeviceMetadata(metadata({ deviceId: '../escape' }))).toThrow('device id');
		expect(() => parseDeviceMetadata(metadata({ label: ' padded ' }))).toThrow('label');
		expect(() => parseDeviceMetadata(metadata({ createdAt: 'not-a-date' }))).toThrow('timestamp');
		expect(() => parseDeviceMetadata(metadata({ schemaVersion: 2 }))).toThrow('schemaVersion');
	});
});
