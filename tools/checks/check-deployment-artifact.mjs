#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECKSUM_FILE = 'SHA256SUMS';
const MANIFEST_FILE = 'DEPLOYMENT-MANIFEST.txt';
const REQUIRED_SITE_FILES = Object.freeze([
	'200.html',
	'_headers',
	'manifest.webmanifest',
	'registerSW.js',
	'sw.js'
]);
const MANIFEST_KEYS = Object.freeze([
	'schema_version',
	'source_repository',
	'source_commit',
	'target_environment',
	'created_utc',
	'node_version',
	'pnpm_version',
	'package_sha256',
	'lock_sha256'
]);

/** @param {string} message */
function contractFailure(message) {
	return new Error(`Deployment artifact contract failed: ${message}`);
}

/** @param {string} root @param {string} absolutePath */
function toPortablePath(root, absolutePath) {
	return relative(root, absolutePath).split(sep).join('/');
}

/** @param {string} root @returns {Promise<string[]>} */
async function listFiles(root) {
	/** @type {string[]} */
	const files = [];

	/** @param {string} directory */
	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const absolutePath = join(directory, entry.name);
			const metadata = await lstat(absolutePath);
			if (metadata.isSymbolicLink()) {
				throw contractFailure(
					`symbolic links are not allowed: ${toPortablePath(root, absolutePath)}`
				);
			}
			if (metadata.isDirectory()) {
				await visit(absolutePath);
				continue;
			}
			if (!metadata.isFile()) {
				throw contractFailure(
					`unsupported filesystem entry: ${toPortablePath(root, absolutePath)}`
				);
			}
			files.push(toPortablePath(root, absolutePath));
		}
	}

	await visit(root);
	return files;
}

/**
 * @param {string} source
 * @returns {{ schemaVersion: 1; sourceCommit: string; targetEnvironment: 'staging' | 'production' }}
 */
function parseManifest(source) {
	/** @type {Map<string, string>} */
	const values = new Map();
	for (const line of source.split(/\r?\n/)) {
		if (line === '') continue;
		const separator = line.indexOf('=');
		if (separator <= 0) throw contractFailure('deployment manifest contains an invalid line');
		const key = line.slice(0, separator);
		const value = line.slice(separator + 1);
		if (!MANIFEST_KEYS.includes(key)) {
			throw contractFailure(`deployment manifest contains an unknown field: ${key}`);
		}
		if (values.has(key)) throw contractFailure(`deployment manifest repeats field: ${key}`);
		values.set(key, value);
	}

	for (const key of MANIFEST_KEYS) {
		if (!values.has(key)) throw contractFailure(`deployment manifest is missing field: ${key}`);
	}
	if (values.size !== MANIFEST_KEYS.length) {
		throw contractFailure('deployment manifest field coverage is invalid');
	}
	if (values.get('schema_version') !== '1') {
		throw contractFailure('unsupported deployment manifest schema');
	}
	if (values.get('source_repository') !== 'Semogtw/FicharioVirtual') {
		throw contractFailure('deployment manifest source repository is invalid');
	}
	const sourceCommit = values.get('source_commit') ?? '';
	if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
		throw contractFailure('deployment manifest source commit is invalid');
	}
	const targetEnvironment = values.get('target_environment') ?? '';
	if (targetEnvironment !== 'staging' && targetEnvironment !== 'production') {
		throw contractFailure('deployment manifest target environment is invalid');
	}
	const createdUtc = values.get('created_utc') ?? '';
	const parsedCreatedUtc = new Date(createdUtc);
	const canonicalCreatedUtc = Number.isNaN(parsedCreatedUtc.getTime())
		? null
		: parsedCreatedUtc.toISOString().replace('.000Z', 'Z');
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(createdUtc) ||
		canonicalCreatedUtc !== createdUtc
	) {
		throw contractFailure('deployment manifest creation timestamp is invalid');
	}
	if (!/^v22\.\d+\.\d+$/.test(values.get('node_version') ?? '')) {
		throw contractFailure('deployment manifest Node.js version is invalid');
	}
	if (!/^10\.\d+\.\d+$/.test(values.get('pnpm_version') ?? '')) {
		throw contractFailure('deployment manifest pnpm version is invalid');
	}
	for (const key of ['package_sha256', 'lock_sha256']) {
		if (!/^[0-9a-f]{64}$/.test(values.get(key) ?? '')) {
			throw contractFailure(`deployment manifest ${key} is invalid`);
		}
	}

	return {
		schemaVersion: 1,
		sourceCommit,
		targetEnvironment
	};
}

/** @param {string} value @returns {string} */
function parseChecksumPath(value) {
	if (!value.startsWith('./')) throw contractFailure(`unsafe checksum path: ${value}`);
	const withoutPrefix = value.slice(2);
	if (
		withoutPrefix === '' ||
		withoutPrefix.includes('\\') ||
		withoutPrefix.includes('\0') ||
		posix.isAbsolute(withoutPrefix) ||
		posix.normalize(withoutPrefix) !== withoutPrefix ||
		withoutPrefix.split('/').some((part) => part === '' || part === '.' || part === '..')
	) {
		throw contractFailure(`unsafe checksum path: ${value}`);
	}
	return withoutPrefix;
}

/** @param {string} source @returns {Map<string, string>} */
function parseChecksums(source) {
	/** @type {Map<string, string>} */
	const checksums = new Map();
	for (const line of source.split(/\r?\n/)) {
		if (line === '') continue;
		const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
		if (!match) throw contractFailure('SHA256SUMS contains an invalid line');
		const [, digest, rawPath] = match;
		const portablePath = parseChecksumPath(rawPath);
		if (portablePath === CHECKSUM_FILE) {
			throw contractFailure('SHA256SUMS must not checksum itself');
		}
		if (checksums.has(portablePath)) {
			throw contractFailure(`SHA256SUMS repeats path: ${portablePath}`);
		}
		checksums.set(portablePath, digest);
	}
	if (checksums.size === 0) throw contractFailure('SHA256SUMS is empty');
	return checksums;
}

/** @param {string} path @returns {Promise<string>} */
async function sha256File(path) {
	const bytes = await readFile(path);
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {string} inputPath
 * @returns {Promise<{ schemaVersion: 1; sourceCommit: string; targetEnvironment: 'staging' | 'production'; verifiedFiles: number }>}
 */
export async function verifyDeploymentArtifact(inputPath) {
	const root = resolve(inputPath);
	const rootMetadata = await lstat(root).catch(() => null);
	if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
		throw contractFailure('artifact root must be a real directory');
	}

	const files = await listFiles(root);
	for (const required of [
		MANIFEST_FILE,
		CHECKSUM_FILE,
		...REQUIRED_SITE_FILES.map((file) => `site/${file}`)
	]) {
		if (!files.includes(required))
			throw contractFailure(`artifact is missing required file: ${required}`);
	}
	for (const file of files) {
		if (file.startsWith('site/') && [MANIFEST_FILE, CHECKSUM_FILE].includes(posix.basename(file))) {
			throw contractFailure(
				`deployment metadata must remain outside the public site root: ${file}`
			);
		}
		if (!file.startsWith('site/') && file !== MANIFEST_FILE && file !== CHECKSUM_FILE) {
			throw contractFailure(`unexpected file outside the public site root: ${file}`);
		}
	}

	const manifest = parseManifest(await readFile(join(root, MANIFEST_FILE), 'utf8'));
	const checksums = parseChecksums(await readFile(join(root, CHECKSUM_FILE), 'utf8'));
	const expectedCoverage = files.filter((file) => file !== CHECKSUM_FILE).sort();
	const checksumCoverage = [...checksums.keys()].sort();
	if (
		expectedCoverage.length !== checksumCoverage.length ||
		expectedCoverage.some((file, index) => file !== checksumCoverage[index])
	) {
		throw contractFailure('checksum coverage does not exactly match artifact files');
	}

	for (const [portablePath, expectedDigest] of checksums) {
		const absolutePath = resolve(root, portablePath);
		if (dirname(absolutePath) !== root && !absolutePath.startsWith(`${root}${sep}`)) {
			throw contractFailure(`unsafe checksum path: ./${portablePath}`);
		}
		const actualDigest = await sha256File(absolutePath);
		if (actualDigest !== expectedDigest) {
			throw contractFailure(`checksum mismatch for ${portablePath}`);
		}
	}

	return {
		...manifest,
		verifiedFiles: checksums.size
	};
}

async function runCli() {
	const rawArguments = process.argv.slice(2);
	const argumentsAfterSeparator = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
	const [artifactPath] = argumentsAfterSeparator;
	if (!artifactPath || argumentsAfterSeparator.length !== 1) {
		throw new TypeError(
			'Usage: node tools/checks/check-deployment-artifact.mjs <artifact-directory>'
		);
	}
	const result = await verifyDeploymentArtifact(artifactPath);
	console.log(
		`Deployment artifact contract: PASS (${result.verifiedFiles} files, ${result.targetEnvironment}, ${result.sourceCommit})`
	);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
	runCli().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
