import { describe, expect, it } from 'vitest';
import { discardCorrectionDraft, listCorrectionDrafts } from '../../../src/lib/review/draft-index';
import { correctionDraftKey, serializeCorrectionDraft } from '../../../src/lib/review/drafts';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	get length() {
		return this.values.size;
	}
	clear() {
		this.values.clear();
	}
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

describe('correction draft index', () => {
	it('lists only valid correction drafts, newest first', () => {
		const storage = new MemoryStorage();
		storage.setItem('unrelated', 'value');
		storage.setItem(
			correctionDraftKey(first),
			serializeCorrectionDraft({
				pageId: first,
				text: 'Primeiro',
				updatedAt: '2026-08-02T01:00:00.000Z'
			})
		);
		storage.setItem(
			correctionDraftKey(second),
			serializeCorrectionDraft({
				pageId: second,
				text: 'Segundo',
				updatedAt: '2026-08-02T02:00:00.000Z'
			})
		);
		storage.setItem('fichario:correction-draft:v1:bad', '{');

		expect(listCorrectionDrafts(storage).map((draft) => draft.pageId)).toEqual([second, first]);
	});

	it('discards only the requested page draft', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			correctionDraftKey(first),
			serializeCorrectionDraft({
				pageId: first,
				text: 'Primeiro',
				updatedAt: '2026-08-02T01:00:00.000Z'
			})
		);
		storage.setItem('unrelated', 'value');

		discardCorrectionDraft(first, storage);
		expect(storage.getItem(correctionDraftKey(first))).toBeNull();
		expect(storage.getItem('unrelated')).toBe('value');
	});

	it('normalizes storage access failures without leaking browser details', () => {
		const readingFailure = new MemoryStorage();
		Object.defineProperty(readingFailure, 'length', {
			get() {
				throw new DOMException('storage blocked by policy', 'SecurityError');
			}
		});
		expect(() => listCorrectionDrafts(readingFailure)).toThrow(
			'Não foi possível acessar os rascunhos locais.'
		);

		const removalFailure = new MemoryStorage();
		removalFailure.removeItem = () => {
			throw new DOMException('storage removal denied', 'SecurityError');
		};
		expect(() => discardCorrectionDraft(first, removalFailure)).toThrow(
			'Não foi possível acessar os rascunhos locais.'
		);
	});
});
