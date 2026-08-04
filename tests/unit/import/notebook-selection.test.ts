import { describe, expect, it } from 'vitest';
import {
	importHref,
	parseRequestedNotebookId,
	resolveImportNotebookSelection,
	resolveRequestedNotebookId
} from '../../../src/lib/import/notebook-selection';

const notebookId = '11111111-1111-4111-8111-111111111111';

describe('import notebook selection', () => {
	it('accepts only a single valid UUID from the query string', () => {
		expect(parseRequestedNotebookId(new URLSearchParams(`notebook=${notebookId}`))).toBe(
			notebookId
		);
		expect(parseRequestedNotebookId(new URLSearchParams('notebook=not-a-uuid'))).toBeNull();
		expect(
			parseRequestedNotebookId(
				new URLSearchParams(`notebook=${notebookId}&notebook=22222222-2222-4222-8222-222222222222`)
			)
		).toBeNull();
	});

	it('selects the requested notebook only after it exists in the loaded collection', () => {
		expect(resolveRequestedNotebookId(notebookId, [])).toBe('');
		expect(resolveRequestedNotebookId(notebookId, [{ id: notebookId }])).toBe(notebookId);
		expect(resolveRequestedNotebookId(null, [{ id: notebookId }])).toBe('');
	});

	it('does not silently drop a requested notebook before it is confirmed', () => {
		expect(resolveImportNotebookSelection(notebookId, [], false)).toEqual({
			notebookId: '',
			requiresResolution: true
		});
		expect(resolveImportNotebookSelection(notebookId, [{ id: notebookId }], true)).toEqual({
			notebookId,
			requiresResolution: false
		});
		expect(resolveImportNotebookSelection(notebookId, [], true)).toEqual({
			notebookId: '',
			requiresResolution: true
		});
		expect(resolveImportNotebookSelection(null, [], false)).toEqual({
			notebookId: '',
			requiresResolution: false
		});
	});

	it('preserves a valid notebook across import tabs and drops invalid values', () => {
		expect(importHref('/import/pdf/', notebookId)).toBe(`/import/pdf/?notebook=${notebookId}`);
		expect(importHref('/import/', null)).toBe('/import/');
		expect(() => importHref('/import/', 'not-a-uuid')).toThrow('Invalid notebook identifier');
	});
});
