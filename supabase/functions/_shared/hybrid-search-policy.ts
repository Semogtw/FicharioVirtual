export const STRONG_LEXICAL_RANK_MIN = 1.5;

type DocumentRow = Readonly<{ document_id: string }>;
type LexicalEvidenceRow = DocumentRow & Readonly<{ rank: number }>;

export type HybridPrecisionPolicy = Readonly<{
	restricted: boolean;
	strongDocumentIds: ReadonlySet<string>;
}>;

export function hybridPrecisionPolicy(
	lexical: readonly LexicalEvidenceRow[]
): HybridPrecisionPolicy {
	const strongDocumentIds = new Set(
		lexical
			.filter((row) => Number.isFinite(row.rank) && row.rank >= STRONG_LEXICAL_RANK_MIN)
			.map((row) => row.document_id)
	);
	return {
		restricted: strongDocumentIds.size > 0,
		strongDocumentIds
	};
}

export function applyHybridPrecision<T extends DocumentRow>(
	rows: readonly T[],
	policy: HybridPrecisionPolicy
): T[] {
	if (!policy.restricted) return [...rows];
	return rows.filter((row) => policy.strongDocumentIds.has(row.document_id));
}
