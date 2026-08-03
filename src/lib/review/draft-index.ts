import { correctionDraftKey, parseCorrectionDraft, type CorrectionDraft } from './drafts';

const PREFIX = 'fichario:correction-draft:v1:';

export class CorrectionDraftStorageError extends Error {
	constructor() {
		super('Não foi possível acessar os rascunhos locais.');
		this.name = 'CorrectionDraftStorageError';
	}
}

export function listCorrectionDrafts(storage: Storage = localStorage): readonly CorrectionDraft[] {
	try {
		const drafts: CorrectionDraft[] = [];
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			if (!key?.startsWith(PREFIX)) continue;
			const pageId = key.slice(PREFIX.length);
			const draft = parseCorrectionDraft(storage.getItem(key), pageId);
			if (draft) drafts.push(draft);
		}
		return Object.freeze(
			drafts.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
		);
	} catch {
		throw new CorrectionDraftStorageError();
	}
}

export function discardCorrectionDraft(pageId: string, storage: Storage = localStorage) {
	const key = correctionDraftKey(pageId);
	try {
		storage.removeItem(key);
	} catch {
		throw new CorrectionDraftStorageError();
	}
}
