<script lang="ts">
	import { onMount } from 'svelte';
	import {
		finishNativeSyncOnce,
		getNativeSyncOnceMode,
		NATIVE_SYNC_ONCE_TIMEOUT_MS
	} from '$lib/native/sync-once';
	import { runNativeSyncWorker } from '$lib/native/sync-worker';

	onMount(() => {
		const run = async () => {
			let syncOnce = false;
			try {
				syncOnce = await getNativeSyncOnceMode();
			} catch {
				// Older/native runtimes keep the regular foreground lifecycle.
			}
			if (!syncOnce) return;
			await Promise.race([
				runNativeSyncWorker().catch(() => undefined),
				new Promise<void>((resolve) =>
					window.setTimeout(resolve, NATIVE_SYNC_ONCE_TIMEOUT_MS)
				)
			]);
			await finishNativeSyncOnce().catch(() => undefined);
		};

		void run();
	});
</script>
