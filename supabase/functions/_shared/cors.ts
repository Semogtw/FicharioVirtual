const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

type OriginRule =
	| Readonly<{ kind: 'exact'; origin: string }>
	| Readonly<{ kind: 'single-subdomain'; hostnameSuffix: string }>;

function normalizeExactOrigin(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}

	if (
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search.length > 0 ||
		url.hash.length > 0
	) {
		return null;
	}

	if (url.protocol === 'https:') return url.origin;
	if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url.origin;
	return null;
}

function parseOriginRule(value: string): OriginRule | null {
	const candidate = value.trim();
	if (!candidate || candidate === '*') return null;

	if (!candidate.includes('*')) {
		const origin = normalizeExactOrigin(candidate);
		return origin ? Object.freeze({ kind: 'exact', origin }) : null;
	}

	const wildcardMatch = /^https:\/\/\*\.([A-Za-z0-9.-]+)\/?$/u.exec(candidate);
	if (!wildcardMatch) return null;
	const hostnameSuffix = wildcardMatch[1]!.toLowerCase();
	let suffixUrl: URL;
	try {
		suffixUrl = new URL(`https://${hostnameSuffix}`);
	} catch {
		return null;
	}
	if (
		suffixUrl.hostname !== hostnameSuffix ||
		suffixUrl.port ||
		hostnameSuffix.startsWith('.') ||
		hostnameSuffix.endsWith('.') ||
		!hostnameSuffix.includes('.')
	) {
		return null;
	}
	return Object.freeze({ kind: 'single-subdomain', hostnameSuffix });
}

function parseOriginRules(value: string | undefined): readonly OriginRule[] | null {
	const candidate = value?.trim();
	if (!candidate) return null;
	const parts = candidate.split(',');
	if (parts.some((part) => part.trim().length === 0)) return null;
	const rules = parts.map(parseOriginRule);
	if (rules.some((rule) => rule === null)) return null;
	return Object.freeze(rules as OriginRule[]);
}

function ruleAllowsOrigin(rule: OriginRule, origin: string): boolean {
	if (rule.kind === 'exact') return rule.origin === origin;

	const url = new URL(origin);
	if (url.protocol !== 'https:' || url.port) return false;
	const suffix = `.${rule.hostnameSuffix}`;
	if (!url.hostname.endsWith(suffix)) return false;
	const label = url.hostname.slice(0, -suffix.length);
	return label.length > 0 && !label.includes('.');
}

export function parseAppOrigin(
	value: string | undefined,
	requestOrigin?: string | null
): string | null {
	const rules = parseOriginRules(value);
	if (!rules) return null;

	if (requestOrigin !== undefined && requestOrigin !== null) {
		const normalizedRequestOrigin = normalizeExactOrigin(requestOrigin.trim());
		if (!normalizedRequestOrigin) return null;
		return rules.some((rule) => ruleAllowsOrigin(rule, normalizedRequestOrigin))
			? normalizedRequestOrigin
			: null;
	}

	return (
		rules.find((rule): rule is Extract<OriginRule, { kind: 'exact' }> => rule.kind === 'exact')
			?.origin ?? null
	);
}

export function corsHeaders(appOrigin: string | null): Record<string, string> {
	return {
		...(appOrigin ? { 'Access-Control-Allow-Origin': appOrigin } : {}),
		'Access-Control-Allow-Headers':
			'authorization, x-client-info, x-supabase-api-version, apikey, content-type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		Vary: 'Origin'
	};
}
