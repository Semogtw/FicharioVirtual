import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	const { providerProfile } = await parent();
	if (providerProfile !== 'owner') {
		error(403, 'A fila de leitura local está disponível apenas para contas owner.');
	}
	return {};
};
