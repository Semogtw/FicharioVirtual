const INVISIBLE_SEMANTIC_ARTIFACTS = /[\u00ad\u200b-\u200d\u2060\ufeff]/gu;
const OCR_HYPHENATED_LINE_BREAK = /(\p{L}{3,})[-\u2010\u2011][ \t]*\n[ \t]*(\p{Ll}{3,})/gu;

function normalizeUnicodeArtifacts(value: string) {
	return value
		.normalize('NFKC')
		.replace(INVISIBLE_SEMANTIC_ARTIFACTS, '')
		.replace(/\r\n?/g, '\n');
}

/**
 * Conservative normalization for OCR/native text before semantic chunking.
 *
 * It repairs layout artifacts that should not carry meaning while avoiding
 * dictionary-based spelling correction, which could damage names and technical
 * vocabulary. The canonical page text remains untouched in the database.
 */
export function normalizeSemanticDocumentText(value: string) {
	return normalizeUnicodeArtifacts(value)
		.replace(OCR_HYPHENATED_LINE_BREAK, '$1$2')
		.replace(/[\t\f\v]+/g, ' ')
		.replace(/[ ]{2,}/g, ' ')
		.replace(/[ ]*\n[ ]*/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Query normalization must match the text used to create the cached vector so
 * equivalent spellings cannot share a cache key while embedding different text.
 */
export function normalizeSemanticQueryText(value: string) {
	return normalizeUnicodeArtifacts(value)
		.replace(/\s+/gu, ' ')
		.trim()
		.toLocaleLowerCase('pt-BR');
}
