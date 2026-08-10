#!/usr/bin/env node

function requireValue(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is not configured in staging.`);
	return value;
}

const target = requireValue('TARGET_ENVIRONMENT');
if (target !== 'staging') {
	throw new Error('TARGET_ENVIRONMENT must remain staging until production infrastructure exists.');
}

const urlValue = requireValue('PUBLIC_SUPABASE_URL');
const publishableKey = requireValue('PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const googleClientId = requireValue('PUBLIC_GOOGLE_CLIENT_ID');
const pickerApiKey = requireValue('PUBLIC_GOOGLE_PICKER_API_KEY');
const projectNumber = requireValue('PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER');

const url = new URL(urlValue);
if (
	url.protocol !== 'https:' ||
	url.username ||
	url.password ||
	url.pathname !== '/' ||
	url.search ||
	url.hash
) {
	throw new Error('PUBLIC_SUPABASE_URL must be a credential-free HTTPS origin.');
}
if (
	!publishableKey.startsWith('sb_publishable_') ||
	publishableKey.length < 20 ||
	publishableKey.length > 512
) {
	throw new Error('PUBLIC_SUPABASE_PUBLISHABLE_KEY is invalid.');
}
if (
	googleClientId.length < 20 ||
	googleClientId.length > 512 ||
	!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(googleClientId)
) {
	throw new Error('PUBLIC_GOOGLE_CLIENT_ID is invalid.');
}
if (
	pickerApiKey.length < 20 ||
	pickerApiKey.length > 256 ||
	!/^AIza[A-Za-z0-9_-]+$/.test(pickerApiKey)
) {
	throw new Error('PUBLIC_GOOGLE_PICKER_API_KEY is invalid.');
}
if (!/^\d{6,20}$/.test(projectNumber)) {
	throw new Error('PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER is invalid.');
}

console.log('Staging public release configuration is valid, including Google Drive Picker.');
