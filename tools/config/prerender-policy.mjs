const CLIENT_ONLY_DYNAMIC_ROUTES = Object.freeze(['/documents/[id]', '/notebooks/[id]']);

export function handleUnseenClientRoutes({ routes, message }) {
	const observed = new Set(routes);
	const exactMatch =
		observed.size === CLIENT_ONLY_DYNAMIC_ROUTES.length &&
		CLIENT_ONLY_DYNAMIC_ROUTES.every((route) => observed.has(route));

	if (!exactMatch) throw new Error(message);
}

export function clientOnlyDynamicRoutes() {
	return [...CLIENT_ONLY_DYNAMIC_ROUTES];
}
