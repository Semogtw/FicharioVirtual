<script lang="ts">
	import { onMount } from 'svelte';
	import { driveConnectionPresentation, type DriveConnection } from '$lib/drive/connection-state';
	import {
		beginDriveConnection,
		isDriveOAuthConfigured,
		loadDriveConnection,
		synchronizeDriveConnection
	} from '$lib/services/drive';
	import Button from './Button.svelte';

	type DriveOAuthResult = 'authorized' | 'cancelled' | 'error';

	const configured = isDriveOAuthConfigured();
	let connection = $state<DriveConnection | null>(null);
	let loading = $state(true);
	let connecting = $state(false);
	let synchronizing = $state(false);
	let error = $state<string | null>(null);
	let syncMessage = $state<string | null>(null);
	let presentation = $derived(driveConnectionPresentation({ configured, connection }));

	function consumeOAuthResult(): DriveOAuthResult | null {
		const url = new URL(window.location.href);
		const value = url.searchParams.get('drive');
		if (value !== 'authorized' && value !== 'cancelled' && value !== 'error') return null;
		url.searchParams.delete('drive');
		window.history.replaceState(
			window.history.state,
			'',
			`${url.pathname}${url.search}${url.hash}`
		);
		return value;
	}

	async function refresh() {
		if (connecting || synchronizing) return;
		loading = true;
		error = null;
		try {
			connection = await loadDriveConnection();
		} catch {
			error = 'Não foi possível verificar o Google Drive agora.';
		} finally {
			loading = false;
		}
	}

	async function refreshAfterAuthorization(): Promise<boolean> {
		for (let attempt = 0; attempt < 4; attempt += 1) {
			await refresh();
			if (connection?.status === 'connected' || connection?.status === 'syncing') return true;
			if (attempt < 3)
				await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
		}
		return false;
	}

	async function connect() {
		if (!configured || loading || connecting || synchronizing || !presentation.canConnect) return;
		connecting = true;
		error = null;
		syncMessage = null;
		try {
			const authorizationUrl = await beginDriveConnection();
			window.location.assign(authorizationUrl);
		} catch {
			error = 'Não foi possível abrir a conexão com o Google Drive. Tente novamente.';
			connecting = false;
		}
	}

	async function synchronize() {
		if (loading || connecting || synchronizing || !presentation.canSynchronize) return;
		synchronizing = true;
		error = null;
		syncMessage = null;
		try {
			const receipt = await synchronizeDriveConnection();
			if (receipt.conflicts > 0) {
				syncMessage = `Sincronização concluída. ${receipt.conflicts} item${receipt.conflicts === 1 ? '' : 's'} precisa${receipt.conflicts === 1 ? '' : 'm'} de atenção.`;
			} else if (receipt.status === 'partial') {
				syncMessage = 'Parte dos arquivos foi atualizada. Sincronize novamente para continuar.';
			} else {
				syncMessage = 'Google Drive atualizado.';
			}
			synchronizing = false;
			await refresh();
		} catch {
			error = 'Não foi possível sincronizar o Google Drive agora.';
		} finally {
			synchronizing = false;
		}
	}

	onMount(() => {
		let disposed = false;
		const oauthResult = consumeOAuthResult();

		void (async () => {
			if (oauthResult === 'authorized') {
				const connected = await refreshAfterAuthorization();
				if (disposed) return;
				if (connected) syncMessage = 'Google Drive conectado.';
				else
					error =
						'A conta foi autorizada, mas a conexão não ficou pronta. Tente conectar novamente.';
				return;
			}

			await refresh();
			if (disposed) return;
			if (oauthResult === 'cancelled') syncMessage = 'Conexão cancelada.';
			if (oauthResult === 'error')
				error = 'Não foi possível concluir a conexão com o Google Drive.';
		})();

		const refreshWhenVisible = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		window.addEventListener('focus', refreshWhenVisible);
		document.addEventListener('visibilitychange', refreshWhenVisible);
		return () => {
			disposed = true;
			window.removeEventListener('focus', refreshWhenVisible);
			document.removeEventListener('visibilitychange', refreshWhenVisible);
		};
	});
</script>

<section class={`drive-card ${presentation.kind}`} aria-labelledby="drive-title">
	<div class="drive-copy">
		<div class="heading-row">
			<div>
				<p class="eyebrow">Google Drive</p>
				<h2 id="drive-title">Seus arquivos na nuvem</h2>
			</div>
			<span class="status" aria-live="polite">
				{loading ? 'Verificando…' : synchronizing ? 'Sincronizando…' : presentation.title}
			</span>
		</div>

		<p>{presentation.detail}</p>
		{#if syncMessage}<p class="sync-message" role="status">{syncMessage}</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>

	<div class="actions">
		{#if presentation.canConnect}
			<Button
				label={connecting ? 'Abrindo Google…' : 'Conectar Google Drive'}
				disabled={!configured || loading || connecting || synchronizing}
				onclick={() => void connect()}
			/>
		{/if}
		{#if presentation.canSynchronize}
			<Button
				label={synchronizing ? 'Sincronizando…' : 'Sincronizar agora'}
				disabled={loading || connecting || synchronizing}
				onclick={() => void synchronize()}
			/>
		{/if}
	</div>
</section>

<style>
	.drive-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-left: 0.3rem solid var(--archive);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.drive-card.configuration_required,
	.drive-card.error,
	.drive-card.revoked {
		border-left-color: var(--danger);
	}

	.heading-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0 0 0.3rem;
		color: var(--archive);
		font-size: 0.72rem;
		font-weight: 780;
		letter-spacing: 0.11em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		font-family: var(--font-heading);
		font-size: 1.35rem;
		font-weight: 540;
	}

	.drive-copy > p {
		max-width: 55rem;
		margin: 0.6rem 0 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.status {
		padding: 0.35rem 0.55rem;
		border-radius: 999px;
		background: var(--archive-soft);
		color: var(--archive);
		font-size: 0.78rem;
		font-weight: 760;
		text-align: right;
	}

	.configuration_required .status,
	.error .status,
	.revoked .status {
		background: rgb(var(--danger-rgb) / 8%);
		color: var(--danger);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.sync-message,
	.error {
		padding: 0.65rem 0.75rem;
		border-left: 0.25rem solid var(--archive);
		background: var(--archive-soft);
		color: var(--archive) !important;
	}

	.error {
		border-left-color: var(--danger);
		background: rgb(var(--danger-rgb) / 7%);
		color: var(--danger) !important;
	}

	@media (max-width: 760px) {
		.drive-card {
			grid-template-columns: 1fr;
		}

		.heading-row {
			align-items: stretch;
			flex-direction: column;
		}

		.status {
			align-self: flex-start;
			text-align: left;
		}

		.actions {
			justify-content: stretch;
		}
	}
</style>
