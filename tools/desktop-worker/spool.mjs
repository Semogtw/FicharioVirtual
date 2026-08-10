import { chmod } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { requireCompletionRequest } from './contract.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE = /^[a-z0-9_]{3,96}$/;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

function validateResult(result) {
	const parsed = requireCompletionRequest(result);
	const json = JSON.stringify(parsed);
	if (Buffer.byteLength(json, 'utf8') > MAX_RESULT_BYTES) {
		throw new TypeError('Desktop worker result is too large');
	}
	return { parsed, json };
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
		result: requireCompletionRequest(JSON.parse(String(record.result_json)))
	});
}

function asRejectedRow(record) {
	if (!record) return null;
	return Object.freeze({
		jobId: String(record.job_id),
		sourceSha256: String(record.source_sha256),
		modelId: String(record.model_id),
		modelVersion: String(record.model_version),
		attemptCount: Number(record.attempt_count),
		createdAt: String(record.created_at),
		rejectedAt: String(record.rejected_at),
		reasonCode: String(record.reason_code),
		result: requireCompletionRequest(JSON.parse(String(record.result_json)))
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
			CREATE TABLE IF NOT EXISTS result_dead_letter (
				job_id TEXT PRIMARY KEY,
				source_sha256 TEXT NOT NULL,
				model_id TEXT NOT NULL,
				model_version TEXT NOT NULL,
				result_json TEXT NOT NULL,
				attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
				created_at TEXT NOT NULL,
				rejected_at TEXT NOT NULL,
				reason_code TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS result_dead_letter_rejected_idx
				ON result_dead_letter (rejected_at, job_id);
		`);
		chmod(path, 0o600).catch(() => undefined);
	}

	close() {
		this.#database.close();
	}

	enqueue(result, now = new Date()) {
		const { parsed, json } = validateResult(result);
		const timestamp = now.toISOString();
		const rejected = this.#database
			.prepare('SELECT source_sha256, result_json FROM result_dead_letter WHERE job_id = ?')
			.get(parsed.jobId);
		if (rejected) {
			if (rejected.source_sha256 !== parsed.sourceSha256 || rejected.result_json !== json) {
				throw new Error('Desktop worker spool idempotency conflict');
			}
			return this.getRejected(parsed.jobId);
		}
		const existing = this.#database
			.prepare('SELECT source_sha256, result_json, state FROM result_spool WHERE job_id = ?')
			.get(parsed.jobId);
		if (existing) {
			if (existing.source_sha256 !== parsed.sourceSha256 || existing.result_json !== json) {
				throw new Error('Desktop worker spool idempotency conflict');
			}
			return asRow(
				this.#database.prepare('SELECT * FROM result_spool WHERE job_id = ?').get(parsed.jobId)
			);
		}
		this.#database
			.prepare(
				`
				INSERT INTO result_spool (
					job_id, source_sha256, model_id, model_version, result_json,
					state, attempt_count, created_at, updated_at, accepted_at
				) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL)
			`
			)
			.run(
				parsed.jobId,
				parsed.sourceSha256,
				parsed.modelId,
				parsed.modelVersion,
				json,
				timestamp,
				timestamp
			);
		return this.get(parsed.jobId);
	}

	get(jobId) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		return asRow(this.#database.prepare('SELECT * FROM result_spool WHERE job_id = ?').get(jobId));
	}

	getRejected(jobId) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		return asRejectedRow(
			this.#database.prepare('SELECT * FROM result_dead_letter WHERE job_id = ?').get(jobId)
		);
	}

	listPending(limit = 20) {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new TypeError('Invalid desktop worker spool limit');
		}
		return this.#database
			.prepare(
				`
				SELECT * FROM result_spool
				WHERE state = 'pending'
				ORDER BY created_at ASC, job_id ASC
				LIMIT ?
			`
			)
			.all(limit)
			.map(asRow);
	}

	listRejected(limit = 20) {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new TypeError('Invalid desktop worker dead-letter limit');
		}
		return this.#database
			.prepare(
				`
				SELECT * FROM result_dead_letter
				ORDER BY rejected_at DESC, job_id ASC
				LIMIT ?
			`
			)
			.all(limit)
			.map(asRejectedRow);
	}

	markAttempt(jobId, now = new Date()) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		const result = this.#database
			.prepare(
				`
				UPDATE result_spool
				SET attempt_count = attempt_count + 1, updated_at = ?
				WHERE job_id = ? AND state = 'pending'
			`
			)
			.run(now.toISOString(), jobId);
		return Number(result.changes) === 1;
	}

	markAccepted(jobId, now = new Date()) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		const timestamp = now.toISOString();
		const result = this.#database
			.prepare(
				`
				UPDATE result_spool
				SET state = 'accepted', accepted_at = ?, updated_at = ?
				WHERE job_id = ? AND state = 'pending'
			`
			)
			.run(timestamp, timestamp, jobId);
		return Number(result.changes) === 1;
	}

	markRejected(jobId, reasonCode, now = new Date()) {
		if (!UUID.test(jobId)) throw new TypeError('Invalid desktop worker jobId');
		if (typeof reasonCode !== 'string' || !SAFE_CODE.test(reasonCode)) {
			throw new TypeError('Invalid desktop worker rejection reason');
		}
		const timestamp = now.toISOString();
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			const pending = this.#database
				.prepare("SELECT * FROM result_spool WHERE job_id = ? AND state = 'pending'")
				.get(jobId);
			if (!pending || Number(pending.attempt_count) < 1) {
				this.#database.exec('ROLLBACK');
				return false;
			}
			this.#database
				.prepare(
					`
					INSERT INTO result_dead_letter (
						job_id, source_sha256, model_id, model_version, result_json,
						attempt_count, created_at, rejected_at, reason_code
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					`
				)
				.run(
					pending.job_id,
					pending.source_sha256,
					pending.model_id,
					pending.model_version,
					pending.result_json,
					pending.attempt_count,
					pending.created_at,
					timestamp,
					reasonCode
				);
			const removed = this.#database
				.prepare("DELETE FROM result_spool WHERE job_id = ? AND state = 'pending'")
				.run(jobId);
			if (Number(removed.changes) !== 1) throw new Error('Desktop worker dead-letter race');
			this.#database.exec('COMMIT');
			return true;
		} catch (error) {
			try {
				this.#database.exec('ROLLBACK');
			} catch {
				// Preserve the original failure if SQLite already closed the transaction.
			}
			throw error;
		}
	}

	purgeAcceptedBefore(cutoff) {
		const timestamp = cutoff.toISOString();
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			const result = this.#database
				.prepare(
					`
					DELETE FROM result_spool
					WHERE state = 'accepted' AND accepted_at IS NOT NULL AND accepted_at < ?
					`
				)
				.run(timestamp);
			this.#database.exec('COMMIT');
			return Number(result.changes);
		} catch (error) {
			this.#database.exec('ROLLBACK');
			throw error;
		}
	}

	purgeRejectedBefore(cutoff) {
		const timestamp = cutoff.toISOString();
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			const result = this.#database
				.prepare(
					`
					DELETE FROM result_dead_letter
					WHERE rejected_at < ?
					`
				)
				.run(timestamp);
			this.#database.exec('COMMIT');
			return Number(result.changes);
		} catch (error) {
			this.#database.exec('ROLLBACK');
			throw error;
		}
	}
}
