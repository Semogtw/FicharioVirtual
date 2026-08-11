import { describe, expect, it } from 'vitest';
import {
	parseNewNotebookInput,
	parseNotebookRecord,
	parseNotebookRecords,
	parseNotebookUpdate
} from '../../../src/lib/services/notebooks';

const notebookId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

function record(overrides: Record<string, unknown> = {}) {
	return {
		id: notebookId,
		name: 'Biologia',
		description: null,
		cover_style: 'linen',
		banner_path: null,
		banner_position_x: 50,
		banner_position_y: 50,
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
		expect(() =>
			parseNotebookRecords([summary({ created_at: '2026-02-30T00:00:00.000Z' })])
		).toThrow('Invalid notebook response');
		expect(() => parseNotebookRecords([summary({ private_content: 'no' })])).toThrow(
			'Invalid notebook response'
		);
		expect(() => parseNotebookRecords([summary(), summary()])).toThrow('Invalid notebook response');
	});
});

describe('notebook input contract', () => {
	it('normalizes create and update inputs', () => {
		expect(
			parseNewNotebookInput({
				name: '  Biologia  ',
				description: '  Células e genética  ',
				coverStyle: ' linen '
			})
		).toEqual({ name: 'Biologia', description: 'Células e genética', coverStyle: 'linen' });
		expect(parseNotebookUpdate({ description: '   ' })).toEqual({ description: null });
	});

	it('rejects unsafe or empty notebook changes', () => {
		expect(() => parseNewNotebookInput({ name: '   ' })).toThrow('Invalid notebook input');
		expect(() => parseNewNotebookInput({ name: 'Bio\u0000logia' })).toThrow(
			'Invalid notebook input'
		);
		expect(() =>
			parseNewNotebookInput({ name: 'Biologia', description: 'x'.repeat(2_001) })
		).toThrow('Invalid notebook input');
		expect(() => parseNewNotebookInput({ name: 'Biologia', coverStyle: '   ' })).toThrow(
			'Invalid notebook input'
		);
		expect(() => parseNotebookUpdate({})).toThrow('Invalid notebook input');
		expect(() => parseNotebookUpdate({ name: '   ' })).toThrow('Invalid notebook input');
	});
});
