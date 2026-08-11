import {
	MAX_TOPIC_LENGTH,
	MAX_UNIT_TOPICS,
	normalizeTopic
} from './topic-coverage';

export type TopicImportConfidence = 'high' | 'medium' | 'low';

export type OcrTopicCandidate = Readonly<{
	text: string;
	confidence: TopicImportConfidence;
	reviewRequired: boolean;
	level: number;
	sourceLine: number;
}>;

export type OcrTopicExtraction = Readonly<{
	topics: readonly OcrTopicCandidate[];
	skippedLines: number;
	truncated: boolean;
}>;

export type OcrTopicExtractionOptions = Readonly<{
	pageNeedsReview?: boolean;
	warningCount?: number;
}>;

type ParsedLine = {
	text: string;
	lineNumber: number;
	explicitMarker: boolean;
	rawLevel: number;
	suspicious: boolean;
};

const GENERIC_HEADERS = new Set([
	'assuntos',
	'conteudo',
	'conteudos',
	'conteudo programatico',
	'conteudos programaticos',
	'ementa',
	'lista de conteudos',
	'programa',
	'programa da disciplina'
]);

const numberedPrefix = /^\s*(\d+(?:\.\d+)*)(?:[.)-])?\s+(.+)$/u;
const romanOrLetterPrefix = /^\s*(?:[A-Za-z]|[IVXLCDMivxlcdm]+)[.)-]\s+(.+)$/u;
const bulletPrefix = /^(\s*)[-*•–—▪●◦]\s+(.+)$/u;
const checkboxPrefix = /^(\s*)[☐☑✓✔]\s*(.+)$/u;

function collapseWhitespace(value: string) {
	return value.replace(/\s+/g, ' ').trim();
}

function probableHeading(value: string) {
	const text = collapseWhitespace(value);
	if (!text || text.length > 90) return false;
	if (text.endsWith(':')) return true;
	const letters = [...text].filter((character) => /\p{L}/u.test(character));
	if (letters.length < 4) return false;
	const uppercase = letters.filter((character) => character === character.toLocaleUpperCase('pt-BR'));
	return uppercase.length / letters.length >= 0.86;
}

function suspiciousText(value: string) {
	if (value.length < 3 || value.length > MAX_TOPIC_LENGTH) return true;
	if (/[�]/u.test(value)) return true;
	const oddCharacters = [...value].filter(
		(character) => !/[\p{L}\p{N}\s.,;:!?()/%+°ºª&–—\-'’]/u.test(character)
	).length;
	if (oddCharacters >= 3) return true;
	if (/(.)\1{4,}/u.test(value)) return true;
	return false;
}

function parseLine(rawLine: string, lineNumber: number): ParsedLine | null {
	const normalizedRaw = rawLine.replace(/\t/g, '    ').trimEnd();
	const trimmed = normalizedRaw.trim();
	if (!trimmed) return null;

	const normalizedHeader = normalizeTopic(trimmed.replace(/:$/, ''));
	if (GENERIC_HEADERS.has(normalizedHeader)) return null;

	const numbered = numberedPrefix.exec(normalizedRaw);
	if (numbered) {
		const numbering = numbered[1] ?? '';
		const text = collapseWhitespace(numbered[2] ?? '');
		return text
			? {
					text,
					lineNumber,
					explicitMarker: true,
					rawLevel: Math.max(0, numbering.split('.').length - 1),
					suspicious: suspiciousText(text)
				}
			: null;
	}

	const bullet = bulletPrefix.exec(normalizedRaw) ?? checkboxPrefix.exec(normalizedRaw);
	if (bullet) {
		const indentation = (bullet[1] ?? '').length;
		const text = collapseWhitespace(bullet[2] ?? '');
		return text
			? {
					text,
					lineNumber,
					explicitMarker: true,
					rawLevel: Math.min(3, Math.floor(indentation / 2)),
					suspicious: suspiciousText(text)
				}
			: null;
	}

	const letter = romanOrLetterPrefix.exec(normalizedRaw);
	if (letter) {
		const text = collapseWhitespace(letter[1] ?? '');
		return text
			? {
					text,
					lineNumber,
					explicitMarker: true,
					rawLevel: 0,
					suspicious: suspiciousText(text)
				}
			: null;
	}

	return {
		text: collapseWhitespace(trimmed),
		lineNumber,
		explicitMarker: false,
		rawLevel: 0,
		suspicious: suspiciousText(trimmed)
	};
}

function downgrade(confidence: TopicImportConfidence): TopicImportConfidence {
	return confidence === 'high' ? 'medium' : 'low';
}

function confidenceFor(
	line: ParsedLine,
	options: Required<OcrTopicExtractionOptions>
): TopicImportConfidence {
	let confidence: TopicImportConfidence = line.explicitMarker ? 'high' : 'medium';
	if (line.suspicious) confidence = downgrade(confidence);
	if (options.pageNeedsReview) confidence = downgrade(confidence);
	if (options.warningCount > 0) confidence = downgrade(confidence);
	return confidence;
}

function mergeContinuation(target: ParsedLine, continuation: ParsedLine) {
	target.text = collapseWhitespace(`${target.text} ${continuation.text}`);
	target.suspicious = target.suspicious || continuation.suspicious || target.text.length > MAX_TOPIC_LENGTH;
}

function deduplicate(lines: readonly ParsedLine[]) {
	const seen = new Set<string>();
	const result: ParsedLine[] = [];
	for (const line of lines) {
		const text = line.text.slice(0, MAX_TOPIC_LENGTH).trim();
		const normalized = normalizeTopic(text);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push({ ...line, text });
	}
	return result;
}

export function extractTopicCandidatesFromOcr(
	input: string,
	options: OcrTopicExtractionOptions = {}
): OcrTopicExtraction {
	if (typeof input !== 'string') throw new TypeError('Invalid OCR topic source');
	const resolvedOptions: Required<OcrTopicExtractionOptions> = {
		pageNeedsReview: options.pageNeedsReview ?? false,
		warningCount: options.warningCount ?? 0
	};
	if (
		!Number.isInteger(resolvedOptions.warningCount) ||
		resolvedOptions.warningCount < 0 ||
		resolvedOptions.warningCount > 100
	) {
		throw new TypeError('Invalid OCR warning count');
	}

	const parsed = input
		.split(/\r?\n/u)
		.map((line, index) => parseLine(line, index + 1))
		.filter((line): line is ParsedLine => line !== null);
	const explicitCount = parsed.filter((line) => line.explicitMarker).length;
	const structuredList = explicitCount >= 2;
	const grouped: ParsedLine[] = [];
	let skippedLines = input.split(/\r?\n/u).length - parsed.length;

	for (const line of parsed) {
		if (structuredList && !line.explicitMarker) {
			if (probableHeading(line.text)) {
				skippedLines += 1;
				continue;
			}
			const previous = grouped.at(-1);
			if (previous?.explicitMarker) {
				mergeContinuation(previous, line);
				continue;
			}
		}
		grouped.push({ ...line });
	}

	const unique = deduplicate(grouped);
	const minimumLevel = unique.length > 0 ? Math.min(...unique.map((line) => line.rawLevel)) : 0;
	const truncated = unique.length > MAX_UNIT_TOPICS;
	const limited = unique.slice(0, MAX_UNIT_TOPICS);
	const topics = limited.map((line) => {
		const confidence = confidenceFor(line, resolvedOptions);
		return Object.freeze({
			text: line.text,
			confidence,
			reviewRequired: confidence === 'low',
			level: Math.min(3, Math.max(0, line.rawLevel - minimumLevel)),
			sourceLine: line.lineNumber
		});
	});

	return Object.freeze({
		topics: Object.freeze(topics),
		skippedLines,
		truncated
	});
}