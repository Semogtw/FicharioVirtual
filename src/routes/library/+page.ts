import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const query = url.searchParams.get('q')?.trim();
	if (query) redirect(307, `/search/?q=${encodeURIComponent(query.slice(0, 200))}`);
	return {};
};
