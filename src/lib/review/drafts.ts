import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 1_000_000;

export type CorrectionDraft = {
	pageId: string;
	text: string;
	updatedAt: string;
};

type StoredCorrectionDraft = CorrectionDraft & { version: 1 };

function validDraft(draft: CorrectionDraft) {
	return (
		UUID.test(draft.pageId) &&
		typeof draft.text === 'string' &&
		draft.text.length <= MAX_TEXT_LENGTH &&
		typeof draft.updatedAt === 'string' &&
		isIsoTimestamp(draft.updatedAt)
	);
}

export function correctionDraftKey(pageId: string) {
	if (!UUID.test(pageId)) throw new TypeError('Invalid correction page identifier');
	return `fichario:correction-draft:v1:${pageId}`;
}

export function serializeCorrectionDraft(draft: CorrectionDraft): string {
	if (!validDraft(draft)) throw new TypeError('Invalid correction draft');
	return JSON.stringify({ version: 1, ...draft } satisfies StoredCorrectionDraft);
}

export function parseCorrectionDraft(
	value: string | null,
	expectedPageId: string
): CorrectionDraft | null {
	if (value === null || !UUID.test(expectedPageId)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const record = parsed as Partial<StoredCorrectionDraft>;
	const draft: CorrectionDraft = {
		pageId: record.pageId ?? '',
		text: record.text ?? '',
		updatedAt: record.updatedAt ?? ''
	};
	if (record.version !== 1 || draft.pageId !== expectedPageId || !validDraft(draft)) return null;
	return Object.freeze(draft);
}
