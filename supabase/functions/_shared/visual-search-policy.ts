const VISUAL_INTENT_PATTERNS = [
	/\bvisual(?:mente)?\b/u,
	/\bimagem\w*/u,
	/\bfoto(?:graf(?:ia|ico|ica)|s)?\b/u,
	/\bmanuscrit\w*/u,
	/\bescrit[ao]s?\s+(?:a|à)\s+mao\b/u,
	/\bcaligraf\w*/u,
	/\bescanead\w*/u,
	/\bdigitaliza(?:do|da|cao|ção)\b/u,
	/\bscan(?:ned)?\b/u,
	/\bdiagrama\w*/u,
	/\bgrafic\w*/u,
	/\btabel\w*/u,
	/\bfigur\w*/u,
	/\bdesenh\w*/u,
	/\bmapa\w*/u,
	/\bfluxograma\w*/u,
	/\bformulario\w*/u,
	/\bcalendario\w*/u,
	/\borganograma\w*/u,
	/\bkanban\b/u,
	/\bquadro\w*\s+(?:com|de)\b/u,
	/\bgrade\w*\s+(?:com|de)\b/u,
	/\blinha\s+do\s+tempo\b/u,
	/\bfluxograma\w*/u,
	/\bflowchart\w*/u,
	/\bhandwrit\w*/u,
	/\bdiagram\w*/u,
	/\bchart\w*/u,
	/\btable\w*/u,
	/\bfigure\w*/u,
	/\bdrawing\w*/u,
	/\bphoto\w*/u,
	/\bimage\w*/u
] as const;

function normalizeVisualIntentQuery(query: string) {
	return query
		.normalize('NFKD')
		.toLocaleLowerCase('pt-BR')
		.replace(/[\u0300-\u036f]/gu, '')
		.replace(/\s+/gu, ' ')
		.trim();
}

/**
 * Standalone visual retrieval is useful when the user asks about the page's
 * appearance or a visual artifact. Without that intent, image similarity is
 * only corroborating evidence; it must not manufacture a result for an
 * ordinary text question.
 */
export function hasVisualSearchIntent(query: string) {
	const normalized = normalizeVisualIntentQuery(query);
	return VISUAL_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}
