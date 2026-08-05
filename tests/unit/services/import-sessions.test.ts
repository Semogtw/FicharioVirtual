import { describe, expect, it } from 'vitest';
import {
	createImportSessionWithGateway,
	listImportSessionsByResumeKeysWithGateway,
	parseImportSession,
	updateImportSessionWithGateway,
	type ImportSessionsGateway
} from '../../../src/lib/services/import-sessions';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const resumeKey = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-08-04T18:00:00.000Z';

function row(overrides: Record<string, unknown> = {}) {
	return {
		id: sessionId,
		user_id: userId,
		status: 'draft',
		total_items: 1,
		prepared_items: 0,
		uploaded_items: 0,
		completed_items: 0,
		last_error_code: null,
		local_resume_key: resumeKey,
		created_at: timestamp,
		updated_at: timestamp,
		finished_at: null,
		...overrides
	};
}

function gateway(events: string[] = []): ImportSessionsGateway {
	return {
		async currentUserId() {
			events.push('user');
			return userId;
		},
		async create(input) {
			events.push(`create:${input.local_resume_key}:${input.total_items}`);
			return row();
		},
		async update(id, changes) {
			events.push(`update:${id}:${changes.status}`);
			return row({ ...changes, id });
		},
		async listActive() {
			return [row()];
		},
		async listByResumeKeys(resumeKeys) {
			events.push(`list:${resumeKeys.join(',')}`);
			return [
				row({
					status: 'completed',
					prepared_items: 1,
					uploaded_items: 1,
					completed_items: 1,
					finished_at: timestamp
				})
			];
		}
	};
}

describe('parseImportSession', () => {
	it('accepts an exact owned session and freezes it', () => {
		const result = parseImportSession(row(), { expectedUserId: userId, expectedId: sessionId });

		expect(result.status).toBe('draft');
		expect(result.localResumeKey).toBe(resumeKey);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('rejects malformed counters, timestamps, ownership and extra keys', () => {
		expect(() =>
			parseImportSession(row({ uploaded_items: 2 }), { expectedUserId: userId })
		).toThrow('Invalid import session response');
		expect(() =>
			parseImportSession(row({ updated_at: 'bad' }), { expectedUserId: userId })
		).toThrow('Invalid import session response');
		expect(() =>
			parseImportSession(row({ user_id: '44444444-4444-4444-8444-444444444444' }), {
				expectedUserId: userId
			})
		).toThrow('Invalid import session response');
		expect(() => parseImportSession(row({ unexpected: true }), { expectedUserId: userId })).toThrow(
			'Invalid import session response'
		);
	});
});

describe('import session mutations', () => {
	it('creates a resumable single-item session for the current user', async () => {
		const events: string[] = [];
		const result = await createImportSessionWithGateway(gateway(events), {
			localResumeKey: resumeKey,
			totalItems: 1
		});

		expect(result.id).toBe(sessionId);
		expect(events).toEqual(['user', `create:${resumeKey}:1`]);
	});

	it('validates monotonic counters before updating progress', async () => {
		const events: string[] = [];
		const result = await updateImportSessionWithGateway(gateway(events), sessionId, {
			status: 'processing',
			totalItems: 1,
			preparedItems: 1,
			uploadedItems: 1,
			completedItems: 0,
			lastErrorCode: null,
			finishedAt: null
		});

		expect(result.status).toBe('processing');
		expect(events).toEqual([`update:${sessionId}:processing`]);
		await expect(
			updateImportSessionWithGateway(gateway(), sessionId, {
				status: 'uploading',
				totalItems: 1,
				preparedItems: 0,
				uploadedItems: 1,
				completedItems: 0,
				lastErrorCode: null,
				finishedAt: null
			})
		).rejects.toThrow(TypeError);
	});
});

describe('import session restoration lookup', () => {
	it('returns terminal sessions for exact resume keys', async () => {
		const events: string[] = [];

		const sessions = await listImportSessionsByResumeKeysWithGateway(gateway(events), userId, [
			resumeKey
		]);

		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.status).toBe('completed');
		expect(sessions[0]?.localResumeKey).toBe(resumeKey);
		expect(Object.isFrozen(sessions)).toBe(true);
		expect(events).toEqual([`list:${resumeKey}`]);
	});

	it('rejects duplicate requests and unexpected resume keys', async () => {
		await expect(
			listImportSessionsByResumeKeysWithGateway(gateway(), userId, [resumeKey, resumeKey])
		).rejects.toThrow(TypeError);
		await expect(
			listImportSessionsByResumeKeysWithGateway(
				{
					...gateway(),
					async listByResumeKeys() {
						return [row({ local_resume_key: '44444444-4444-4444-8444-444444444444' })];
					}
				},
				userId,
				[resumeKey]
			)
		).rejects.toThrow('Invalid import session response');
	});
});
