import { SEMANTIC_SEARCH_STANDALONE_MIN_SIMILARITY } from './semantic-config.ts';

export const STRONG_LEXICAL_RANK_MIN = 1.5;

type DocumentRow = Readonly<{ document_id: string }>;
type LexicalEvidenceRow = DocumentRow & Readonly<{ rank: number }>;
type SemanticEvidenceRow = DocumentRow & Readonly<{ semantic_similarity: number }>;

export type HybridPrecisionPolicy = Readonly<{
	restricted: boolean;
	strongDocumentIds: ReadonlySet<string>;
}>;

function isOpaqueExactTokenQuery(query: string): boolean {
	const normalized = query.trim();
	return normalized.length >= 8 && !/\s/.test(normalized) && /[\d_#@:/.-]/.test(normalized);
}

export function hybridPrecisionPolicy(
	lexical: readonly LexicalEvidenceRow[],
	query = ''
): HybridPrecisionPolicy {
	const strongDocumentIds = new Set(
		lexical
			.filter((row) => Number.isFinite(row.rank) && row.rank >= STRONG_LEXICAL_RANK_MIN)
			.map((row) => row.document_id)
	);
	return {
		restricted: strongDocumentIds.size > 0 && isOpaqueExactTokenQuery(query),
		strongDocumentIds
	};
}

function hasSemanticEvidence(row: DocumentRow): row is SemanticEvidenceRow {
	return 'semantic_similarity' in row && typeof row.semantic_similarity === 'number';
}

export function applyHybridPrecision<T extends DocumentRow>(
	rows: readonly T[],
	policy: HybridPrecisionPolicy
): T[] {
	if (policy.restricted) return rows.filter((row) => policy.strongDocumentIds.has(row.document_id));
	return rows.filter(
		(row) =>
			!hasSemanticEvidence(row) ||
			(Number.isFinite(row.semantic_similarity) &&
				row.semantic_similarity >= SEMANTIC_SEARCH_STANDALONE_MIN_SIMILARITY)
	);
}
