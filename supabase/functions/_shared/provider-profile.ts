export type ProviderProfile = 'owner' | 'public';
export type OcrRouteId = 'owner_gemini' | 'public_azure';

export type ProviderPolicy = Readonly<{
	profile: ProviderProfile;
	ocrRoute: OcrRouteId;
	geminiAllowed: boolean;
	desktopOcrAllowed: boolean;
}>;

const OWNER_POLICY: ProviderPolicy = Object.freeze({
	profile: 'owner',
	ocrRoute: 'owner_gemini',
	geminiAllowed: true,
	desktopOcrAllowed: true
});

const PUBLIC_POLICY: ProviderPolicy = Object.freeze({
	profile: 'public',
	ocrRoute: 'public_azure',
	geminiAllowed: false,
	desktopOcrAllowed: false
});

export function parseProviderProfile(value: unknown): ProviderProfile | null {
	return value === 'owner' || value === 'public' ? value : null;
}

export function providerPolicyFor(profile: ProviderProfile): ProviderPolicy {
	return profile === 'owner' ? OWNER_POLICY : PUBLIC_POLICY;
}

export function parseProviderPolicy(value: unknown): ProviderPolicy | null {
	const profile = parseProviderProfile(value);
	return profile === null ? null : providerPolicyFor(profile);
}
