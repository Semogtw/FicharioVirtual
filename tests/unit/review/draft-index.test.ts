import { describe, expect, it } from 'vitest';
import {
	discardCorrectionDraft,
	listCorrectionDrafts,
	purgeLegacyCorrectionDrafts,
	readCorrectionDraft,
	writeCorrectionDraft
} from '../../../src/lib/review/draft-index';
import { correctionDraftKey, serializeCorrectionDraft } from '../../../src/lib/review/drafts';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
	it('lists only the current user valid drafts, newest first', () => {
		const storage = new MemoryStorage();
		storage.setItem('unrelated', 'value');
		storage.setItem(
			correctionDraftKey(userId, first),
			serializeCorrectionDraft(userId, {
				pageId: first,
				text: 'Primeiro',
				updatedAt: '2026-08-02T01:00:00.000Z'
			})
		);
		storage.setItem(
			correctionDraftKey(userId, second),
			serializeCorrectionDraft(userId, {
				pageId: second,
				text: 'Segundo',
				updatedAt: '2026-08-02T02:00:00.000Z'
			})
		);
		storage.setItem(
			correctionDraftKey(otherUserId, first),
			serializeCorrectionDraft(otherUserId, {
				pageId: first,
				text: 'Segredo de outra conta',
				updatedAt: '2026-08-02T03:00:00.000Z'
			})
		);
		storage.setItem(`fichario:correction-draft:v2:${userId}:bad`, '{');

		expect(listCorrectionDrafts(userId, storage).map((draft) => draft.pageId)).toEqual([
			second,
			first
		]);
		expect(listCorrectionDrafts(userId, storage).map((draft) => draft.text)).not.toContain(
			'Segredo de outra conta'
		);
	});

	it('purges legacy unscoped records without touching current scoped drafts', () => {
		const storage = new MemoryStorage();
		storage.setItem(`fichario:correction-draft:v1:${first}`, 'legacy secret');
		storage.setItem(
			correctionDraftKey(userId, first),
			serializeCorrectionDraft(userId, {
				pageId: first,
				text: 'Atual',
				updatedAt: '2026-08-02T01:00:00.000Z'
			})
		);
		storage.setItem('unrelated', 'value');

		purgeLegacyCorrectionDrafts(storage);

		expect(storage.getItem(`fichario:correction-draft:v1:${first}`)).toBeNull();
		expect(storage.getItem(correctionDraftKey(userId, first))).not.toBeNull();
		expect(storage.getItem('unrelated')).toBe('value');
	});

	it('discards only the requested user page draft', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			correctionDraftKey(userId, first),
			serializeCorrectionDraft(userId, {
				pageId: first,
				text: 'Primeiro',
				updatedAt: '2026-08-02T01:00:00.000Z'
			})
		);
		storage.setItem(
			correctionDraftKey(otherUserId, first),
			serializeCorrectionDraft(otherUserId, {
				pageId: first,
				text: 'Outro',
				updatedAt: '2026-08-02T01:00:00.000Z'
			})
		);

		discardCorrectionDraft(userId, first, storage);
		expect(storage.getItem(correctionDraftKey(userId, first))).toBeNull();
		expect(storage.getItem(correctionDraftKey(otherUserId, first))).not.toBeNull();
	});

	it('reads and writes one page draft through the user-scoped storage boundary', () => {
		const storage = new MemoryStorage();
		const draft = {
			pageId: first,
			text: 'Texto local',
			updatedAt: '2026-08-02T03:00:00.000Z'
		};

		writeCorrectionDraft(userId, draft, storage);
		expect(readCorrectionDraft(userId, first, storage)).toEqual(draft);
		expect(readCorrectionDraft(otherUserId, first, storage)).toBeNull();
	});

	it('normalizes single-draft read and write failures', () => {
		const writeFailure = new MemoryStorage();
		writeFailure.setItem = () => {
			throw new DOMException('quota internals', 'QuotaExceededError');
		};
		expect(() =>
			writeCorrectionDraft(
				userId,
				{ pageId: first, text: 'Texto', updatedAt: '2026-08-02T03:00:00.000Z' },
				writeFailure
			)
		).toThrow('Não foi possível acessar os rascunhos locais.');

		const readFailure = new MemoryStorage();
		readFailure.getItem = () => {
			throw new DOMException('storage internals', 'SecurityError');
		};
		expect(() => readCorrectionDraft(userId, first, readFailure)).toThrow(
			'Não foi possível acessar os rascunhos locais.'
		);
	});

	it('normalizes storage access failures without leaking browser details', () => {
		const readingFailure = new MemoryStorage();
		Object.defineProperty(readingFailure, 'length', {
			get() {
				throw new DOMException('storage blocked by policy', 'SecurityError');
			}
		});
		expect(() => listCorrectionDrafts(userId, readingFailure)).toThrow(
			'Não foi possível acessar os rascunhos locais.'
		);

		const removalFailure = new MemoryStorage();
		removalFailure.removeItem = () => {
			throw new DOMException('storage removal denied', 'SecurityError');
		};
		expect(() => discardCorrectionDraft(userId, first, removalFailure)).toThrow(
			'Não foi possível acessar os rascunhos locais.'
		);
		expect(() => purgeLegacyCorrectionDrafts(removalFailure)).not.toThrow();
		removalFailure.setItem(`fichario:correction-draft:v1:${first}`, 'legacy');
		expect(() => purgeLegacyCorrectionDrafts(removalFailure)).toThrow(
			'Não foi possível acessar os rascunhos locais.'
		);
	});
});
