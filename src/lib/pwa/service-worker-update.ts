export function reloadOnServiceWorkerUpdate(
	hasActiveController: boolean,
	subscribeToControllerChange: (listener: () => void) => void,
	reload: () => void
) {
	if (!hasActiveController) return false;

	let reloading = false;
	subscribeToControllerChange(() => {
		if (reloading) return;
		reloading = true;
		reload();
	});
	return true;
}

export function installServiceWorkerUpdateReload() {
	if (!('serviceWorker' in navigator)) return false;

	const serviceWorker = navigator.serviceWorker;
	return reloadOnServiceWorkerUpdate(
		serviceWorker.controller !== null,
		(listener) => serviceWorker.addEventListener('controllerchange', listener),
		() => window.location.reload()
	);
}
