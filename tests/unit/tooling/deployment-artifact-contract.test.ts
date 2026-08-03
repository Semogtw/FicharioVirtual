import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyDeploymentArtifact } from '../../../tools/checks/check-deployment-artifact.mjs';

function sha256(content: string | Buffer) {
	return createHash('sha256').update(content).digest('hex');
}

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), 'fichario-deployment-artifact-'));
	const site = join(root, 'site');
	const source = join(root, 'source');
	mkdirSync(site);
	mkdirSync(source);
	const packageSource = '{"name":"fichario-virtual"}\n';
	const lockSource = "lockfileVersion: '9.0'\n";
	const files = new Map<string, string | Buffer>([
		[
			'DEPLOYMENT-MANIFEST.txt',
			[
				'schema_version=1',
				'source_repository=Semogtw/FicharioVirtual',
				'source_commit=0123456789abcdef0123456789abcdef01234567',
				'target_environment=staging',
				'created_utc=2026-08-03T02:30:00Z',
				'node_version=v22.16.0',
				'pnpm_version=10.34.5',
				`package_sha256=${sha256(packageSource)}`,
				`lock_sha256=${sha256(lockSource)}`,
				''
			].join('\n')
		],
		['source/package.json', packageSource],
		['source/pnpm-lock.yaml', lockSource],
		['site/200.html', '<!doctype html><title>Fichário</title>'],
		['site/_headers', '/*\n  X-Content-Type-Options: nosniff\n'],
		['site/manifest.webmanifest', '{"name":"Fichário"}'],
		['site/registerSW.js', 'navigator.serviceWorker?.register("/sw.js");'],
		['site/sw.js', 'self.addEventListener("install", () => {});']
	]);
	for (const [relativePath, content] of files) {
		writeFileSync(join(root, relativePath), content);
	}
	writeFileSync(
		join(root, 'SHA256SUMS'),
		[...files]
			.map(([relativePath, content]) => `${sha256(content)}  ./${relativePath}`)
			.sort()
			.join('\n') + '\n'
	);
	return root;
}

describe('deployable artifact verification', () => {
	it('accepts a complete package with exact portable checksums', async () => {
		const result = await verifyDeploymentArtifact(createFixture());

		expect(result).toEqual({
			schemaVersion: 1,
			sourceCommit: '0123456789abcdef0123456789abcdef01234567',
			targetEnvironment: 'staging',
			verifiedFiles: 8
		});
	});

	it('requires source package metadata matching the manifest hashes', async () => {
		const root = createFixture();
		rmSync(join(root, 'source', 'pnpm-lock.yaml'));

		await expect(verifyDeploymentArtifact(root)).rejects.toThrow(/source\/pnpm-lock/);
	});

	it('rejects impossible UTC calendar timestamps', async () => {
		const root = createFixture();
		const manifestPath = join(root, 'DEPLOYMENT-MANIFEST.txt');
		const invalidManifest = readFileSync(manifestPath, 'utf8').replace(
			'created_utc=2026-08-03T02:30:00Z',
			'created_utc=2026-02-31T02:30:00Z'
		);
		writeFileSync(manifestPath, invalidManifest);

		const checksumPath = join(root, 'SHA256SUMS');
		const checksums = readFileSync(checksumPath, 'utf8').replace(
			/^[0-9a-f]{64} {2}\.\/DEPLOYMENT-MANIFEST\.txt$/m,
			`${sha256(invalidManifest)}  ./DEPLOYMENT-MANIFEST.txt`
		);
		writeFileSync(checksumPath, checksums);

		await expect(verifyDeploymentArtifact(root)).rejects.toThrow(/creation timestamp/);
	});

	it('accepts the package-manager argument separator in CLI usage', () => {
		const fixture = createFixture();
		const script = fileURLToPath(
			new URL('../../../tools/checks/check-deployment-artifact.mjs', import.meta.url)
		);
		const result = spawnSync(process.execPath, [script, '--', fixture], { encoding: 'utf8' });

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Deployment artifact contract: PASS');
	});

	it('rejects metadata inside the public site and unsafe checksum paths', async () => {
		const metadataRoot = createFixture();
		writeFileSync(join(metadataRoot, 'site', 'DEPLOYMENT-MANIFEST.txt'), 'leak');
		await expect(verifyDeploymentArtifact(metadataRoot)).rejects.toThrow(/public site root/);

		const traversalRoot = createFixture();
		writeFileSync(join(traversalRoot, 'SHA256SUMS'), `${'0'.repeat(64)}  ../outside\n`);
		await expect(verifyDeploymentArtifact(traversalRoot)).rejects.toThrow(/unsafe checksum path/);
	});

	it('rejects stale checksums and unlisted files', async () => {
		const staleRoot = createFixture();
		writeFileSync(join(staleRoot, 'site', 'sw.js'), 'changed');
		await expect(verifyDeploymentArtifact(staleRoot)).rejects.toThrow(/checksum mismatch/);

		const extraRoot = createFixture();
		writeFileSync(join(extraRoot, 'site', 'unexpected.txt'), 'not listed');
		await expect(verifyDeploymentArtifact(extraRoot)).rejects.toThrow(/checksum coverage/);
	});
});
