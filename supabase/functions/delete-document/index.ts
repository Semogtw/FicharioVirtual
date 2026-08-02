import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, code?: string) {
	return new Response(code ? JSON.stringify({ code }) : null, {
		status,
		headers: {
			...corsHeaders,
			...(code ? { 'Content-Type': 'application/json' } : {})
		}
	});
}

Deno.serve(async (request) => {
	if (request.method === 'OPTIONS') return response(204);
	if (request.method !== 'POST') return response(405, 'method_not_allowed');

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) return response(401, 'authentication_required');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return response(400, 'invalid_json');
	}
	const documentId =
		body && typeof body === 'object' && 'documentId' in body
			? (body as { documentId?: unknown }).documentId
			: null;
	if (typeof documentId !== 'string' || !UUID.test(documentId)) {
		return response(400, 'invalid_document_id');
	}

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!supabaseUrl || !publishableKey) return response(503, 'backend_not_configured');

	const supabase = createClient(supabaseUrl, publishableKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false }
	});

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();
	if (userError || !user) return response(401, 'authentication_required');

	const { data: document, error: loadError } = await supabase
		.from('documents')
		.select('storage_path,thumbnail_path,pages(temporary_image_path)')
		.eq('id', documentId)
		.maybeSingle();
	if (loadError) return response(503, 'document_lookup_failed');
	if (!document) return response(404, 'document_not_found');

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
		if (storageError) return response(503, 'storage_delete_failed');
	}

	const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId);
	if (deleteError) return response(503, 'metadata_delete_failed');

	return response(204);
});
