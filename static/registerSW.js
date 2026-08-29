const nativeTauriRuntime =
	window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost';

if (!nativeTauriRuntime && 'serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
	});
}
