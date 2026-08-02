import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, appOrigin: string | null, code?: string) {
	return new Response(code ? JSON.stringify({ code }) : null, {
		status,
		headers: {
			...corsHeaders(appOrigin),
			'Cache-Control': 'no-store',
			...(code ? { 'Content-Type': 'application/json' } : {})
		}
	});
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, code?: string) => response(status, appOrigin, code);

	if (!appOrigin) return respond(503, 'backend_not_configured');
	if (request.method === 'OPTIONS') return respond(204);
	if (request.method !== 'POST') return respond(405, 'method_not_allowed');

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) return respond(401, 'authentication_required');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return respond(400, 'invalid_json');
	}
	const documentId =
		body && typeof body === 'object' && 'documentId' in body
			? (body as { documentId?: unknown }).documentId
			: null;
	if (typeof documentId !== 'string' || !UUID.test(documentId)) {
		return respond(400, 'invalid_document_id');
	}

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!supabaseUrl || !publishableKey) return respond(503, 'backend_not_configured');

	const supabase = createClient(supabaseUrl, publishableKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false }
	});

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();
	if (userError || !user) return respond(401, 'authentication_required');

	const { data: document, error: loadError } = await supabase
		.from('documents')
		.select('storage_path,thumbnail_path,pages(temporary_image_path)')
		.eq('id', documentId)
		.maybeSingle();
	if (loadError) return respond(503, 'document_lookup_failed');
	if (!document) return respond(204);

	const pagePaths = Array.isArray(document.pages)
		? document.pages
				.map((page) => page.temporary_image_path)
				.filter((path): path is string => typeof path === 'string' && path.length > 0)
		: [];
	const paths = [document.storage_path, document.thumbnail_path, ...pagePaths].filter(
		(path, index, values): path is string =>
			typeof path === 'string' && path.length > 0 && values.indexOf(path) === index
	);

	if (paths.length > 0) {
		const { error: storageError } = await supabase.storage.from('documents').remove(paths);
		if (storageError) return respond(503, 'storage_delete_failed');
	}

	const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId);
	if (deleteError) return respond(503, 'metadata_delete_failed');

	return respond(204);
});
