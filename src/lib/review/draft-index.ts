import {
	correctionDraftKey,
	correctionDraftPrefix,
	parseCorrectionDraft,
	serializeCorrectionDraft,
	type CorrectionDraft
} from './drafts';

export class CorrectionDraftStorageError extends Error {
	constructor() {
		super('Não foi possível acessar os rascunhos locais.');
		this.name = 'CorrectionDraftStorageError';
	}
}

export function readCorrectionDraft(
	userId: string,
	pageId: string,
	storage: Storage = localStorage
): CorrectionDraft | null {
	const key = correctionDraftKey(userId, pageId);
	try {
		return parseCorrectionDraft(storage.getItem(key), userId, pageId);
	} catch {
		throw new CorrectionDraftStorageError();
	}
}

export function writeCorrectionDraft(
	userId: string,
	draft: CorrectionDraft,
	storage: Storage = localStorage
) {
	const key = correctionDraftKey(userId, draft.pageId);
	const serialized = serializeCorrectionDraft(userId, draft);
	try {
		storage.setItem(key, serialized);
	} catch {
		throw new CorrectionDraftStorageError();
	}
}

export function listCorrectionDrafts(
	userId: string,
	storage: Storage = localStorage
): readonly CorrectionDraft[] {
	const prefix = correctionDraftPrefix(userId);
	try {
		const drafts: CorrectionDraft[] = [];
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			if (!key?.startsWith(prefix)) continue;
			const pageId = key.slice(prefix.length);
			const draft = parseCorrectionDraft(storage.getItem(key), userId, pageId);
			if (draft) drafts.push(draft);
		}
		return Object.freeze(
			drafts.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
		);
	} catch {
		throw new CorrectionDraftStorageError();
	}
}

export function discardCorrectionDraft(
	userId: string,
	pageId: string,
	storage: Storage = localStorage
) {
	const key = correctionDraftKey(userId, pageId);
	try {
		storage.removeItem(key);
	} catch {
		throw new CorrectionDraftStorageError();
	}
}
