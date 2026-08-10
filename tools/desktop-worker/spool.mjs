import { chmod } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

function requireString(value, label, maximum = 256) {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
		throw new TypeError(`Invalid desktop worker ${label}`);
	}
	return value;
}

function validateResult(result) {
	if (!result || typeof result !== 'object' || Array.isArray(result)) {
		throw new TypeError('Invalid desktop worker result');
	}
	if (!UUID.test(result.jobId)) throw new TypeError('Invalid desktop worker jobId');
	if (!SHA256.test(result.sourceSha256)) throw new TypeError('Invalid desktop worker sourceSha256');
	const modelId = requireString(result.modelId, 'modelId');
	const modelVersion = requireString(result.modelVersion, 'modelVersion');
	const json = JSON.stringify(result);
	if (Buffer.byteLength(json, 'utf8') > MAX_RESULT_BYTES) {
		throw new TypeError('Desktop worker result is too large');
	}
	return { json, modelId, modelVersion };
}

function asRow(record) {
	if (!record) return null;
	return Object.freeze({
		jobId: String(record.job_id),
		sourceSha256: String(record.source_sha256),
		modelId: String(record.model_id),
		modelVersion: String(record.model_version),
		state: String(record.state),
		attemptCount: Number(record.attempt_count),
		createdAt: String(record.created_at),
		updatedAt: String(record.updated_at),
		acceptedAt: record.accepted_at == null ? null : String(record.accepted_at),
		result: JSON.parse(String(record.result_json))
	});
}

export class ResultSpool {
	#database;

	constructor(path) {
		this.#database = new DatabaseSync(path);
		this.#database.exec(`
			PRAGMA foreign_keys = ON;
			PRAGMA journal_mode = DELETE;
			CREATE TABLE IF NOT EXISTS result_spool (
				job_id TEXT PRIMARY KEY,
				source_sha256 TEXT NOT NULL,
				model_id TEXT NOT NULL,
				model_version TEXT NOT NULL,
				result_json TEXT NOT NULL,
				state TEXT NOT NULL CHECK (state IN ('pending', 'accepted')),
				attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				accepted_at TEXT
			);
			CREATE INDEX IF NOT EXISTS result_spool_state_updated_idx
				ON result_spool (state, updated_at);
		`);
		chmod(path, 0o600).catch(() => undefined);
	}

	close() {
		this.#database.close();
	}

	enqueue(result, now = new Date()) {
		const { json, modelId, modelVersion } = validateResult(result);
		const timestamp = now.toISOString();
		const existing = this.#database
			.prepare('SELECT source_sha256, result_json, state FROM result_spool WHERE job_id = ?')
			.get(result.jobId);
		if (existing) {
			if (existing.source_sha256 !== result.sourceSha256 || existing.result_json !== json) {
				throw new Error('Desktop worker spool idempotency conflict');
			}
			return asRow(
				this.#database.prepare('SELECT * FROM result_spool WHERE job_id = ?').get(result.jobId)
			);
		}
		this.#database
			.prepare(`
				INSERT INTO result_spool (
					job_id, source_sha256, model_id, model_version, result_json,
					state, attempt_count, created_at, updated_at, accepted_at
				) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL)
			`)
			.run(
				result.jobId,
				result.sourceSha256,
				modelId,
				modelVersion,
				json,
				timestamp,
				timestamp
			);
		return this.get(result.jobId);
	}

	get(jobId) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		return asRow(this.#database.prepare('SELECT * FROM result_spool WHERE job_id = ?').get(jobId));
	}

	listPending(limit = 20) {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new TypeError('Invalid desktop worker spool limit');
		}
		return this.#database
			.prepare(`
				SELECT * FROM result_spool
				WHERE state = 'pending'
				ORDER BY created_at ASC, job_id ASC
				LIMIT ?
			`)
			.all(limit)
			.map(asRow);
	}

	markAttempt(jobId, now = new Date()) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		const result = this.#database
			.prepare(`
				UPDATE result_spool
				SET attempt_count = attempt_count + 1, updated_at = ?
				WHERE job_id = ? AND state = 'pending'
			`)
			.run(now.toISOString(), jobId);
		return Number(result.changes) === 1;
	}

	markAccepted(jobId, now = new Date()) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		const timestamp = now.toISOString();
		const result = this.#database
			.prepare(`
				UPDATE result_spool
				SET state = 'accepted', accepted_at = ?, updated_at = ?
				WHERE job_id = ? AND state = 'pending'
			`)
			.run(timestamp, timestamp, jobId);
		return Number(result.changes) === 1;
	}

	purgeAcceptedBefore(cutoff) {
		const timestamp = cutoff.toISOString();
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			const result = this.#database
				.prepare(`
					DELETE FROM result_spool
					WHERE state = 'accepted' AND accepted_at IS NOT NULL AND accepted_at < ?
				`)
				.run(timestamp);
			this.#database.exec('COMMIT');
			return Number(result.changes);
		} catch (error) {
			this.#database.exec('ROLLBACK');
			throw error;
		}
	}
}
