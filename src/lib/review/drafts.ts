import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 1_000_000;
const PREFIX = 'fichario:correction-draft:v2:';

export type CorrectionDraft = {
	pageId: string;
	text: string;
	updatedAt: string;
};

type StoredCorrectionDraft = CorrectionDraft & { version: 2; userId: string };

function validUuid(value: string, label: string) {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label}`);
	return value;
}

function validDraft(draft: CorrectionDraft) {
	return (
		UUID.test(draft.pageId) &&
		typeof draft.text === 'string' &&
		draft.text.length <= MAX_TEXT_LENGTH &&
		typeof draft.updatedAt === 'string' &&
		isIsoTimestamp(draft.updatedAt)
	);
}

export function correctionDraftPrefix(userId: string) {
	return `${PREFIX}${validUuid(userId, 'correction draft user identifier')}:`;
}

export function correctionDraftKey(userId: string, pageId: string) {
	return `${correctionDraftPrefix(userId)}${validUuid(pageId, 'correction page identifier')}`;
}

export function serializeCorrectionDraft(userId: string, draft: CorrectionDraft): string {
	const ownerUserId = validUuid(userId, 'correction draft user identifier');
	if (!validDraft(draft)) throw new TypeError('Invalid correction draft');
	return JSON.stringify({
		version: 2,
		userId: ownerUserId,
		...draft
	} satisfies StoredCorrectionDraft);
}

export function parseCorrectionDraft(
	value: string | null,
	expectedUserId: string,
	expectedPageId: string
): CorrectionDraft | null {
	if (value === null || !UUID.test(expectedUserId) || !UUID.test(expectedPageId)) return null;
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
	if (
		record.version !== 2 ||
		record.userId !== expectedUserId ||
		draft.pageId !== expectedPageId ||
		!validDraft(draft)
	) {
		return null;
	}
	return Object.freeze(draft);
}
