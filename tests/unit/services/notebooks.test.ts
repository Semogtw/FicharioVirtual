import { describe, expect, it } from 'vitest';
import {
	parseNotebookRecord,
	parseNotebookRecords
} from '../../../src/lib/services/notebooks';

const notebookId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

function record(overrides: Record<string, unknown> = {}) {
	return {
		id: notebookId,
		name: 'Biologia',
		description: null,
		cover_style: 'linen',
		created_at: '2026-08-02T01:00:00.000Z',
		updated_at: '2026-08-02T02:00:00.000Z',
		...overrides
	};
}

function summary(overrides: Record<string, unknown> = {}) {
	return { ...record(), document_count: 4, ...overrides };
}

describe('notebook response contract', () => {
	it('accepts and freezes exact notebook summaries', () => {
		const result = parseNotebookRecords([summary()]);

		expect(result).toEqual([summary()]);
		expect(Object.isFrozen(result)).toBe(true);
		expect(result.every(Object.isFrozen)).toBe(true);
	});

	it('requires write responses to preserve the requested identity', () => {
		expect(parseNotebookRecord(record(), notebookId)).toEqual(record());
		expect(() => parseNotebookRecord(record({ id: otherId }), notebookId)).toThrow(
			'Invalid notebook response'
		);
	});

	it('rejects malformed, extra or duplicate notebook rows', () => {
		const missingId = { ...summary() } as Record<string, unknown>;
		delete missingId.id;

		expect(() => parseNotebookRecords([missingId])).toThrow('Invalid notebook response');
		expect(() => parseNotebookRecords([summary({ id: 'bad-id' })])).toThrow(
			'Invalid notebook response'
		);
		expect(() => parseNotebookRecords([summary({ document_count: -1 })])).toThrow(
			'Invalid notebook response'
		);
		expect(() => parseNotebookRecords([summary({ private_content: 'no' })])).toThrow(
			'Invalid notebook response'
		);
		expect(() => parseNotebookRecords([summary(), summary()])).toThrow(
			'Invalid notebook response'
		);
	});
});
