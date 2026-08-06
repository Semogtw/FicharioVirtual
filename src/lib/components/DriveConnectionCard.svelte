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

	const configured = isDriveOAuthConfigured();
	let connection = $state<DriveConnection | null>(null);
	let loading = $state(true);
	let connecting = $state(false);
	let synchronizing = $state(false);
	let error = $state<string | null>(null);
	let syncMessage = $state<string | null>(null);
	let presentation = $derived(driveConnectionPresentation({ configured, connection }));

	async function refresh() {
		if (connecting || synchronizing) return;
		loading = true;
		error = null;
		try {
			connection = await loadDriveConnection();
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível carregar a conexão com o Google Drive.';
		} finally {
			loading = false;
		}
	}

	async function connect() {
		if (!configured || loading || connecting || synchronizing || !presentation.canConnect) return;
		connecting = true;
		error = null;
		syncMessage = null;
		try {
			const authorizationUrl = await beginDriveConnection();
			window.location.assign(authorizationUrl);
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível iniciar a conexão com o Google Drive.';
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
			const continuation =
				receipt.status === 'partial'
					? ' O limite desta rodada foi atingido; sincronize novamente para continuar.'
					: '';
			syncMessage = `${receipt.applied} alterações aplicadas, ${receipt.ignored} ignoradas e ${receipt.conflicts} conflitos isolados em ${receipt.pages} página${receipt.pages === 1 ? '' : 's'}.${continuation}`;
			synchronizing = false;
			await refresh();
		} catch (caught) {
			error =
				caught instanceof Error ? caught.message : 'Não foi possível sincronizar o Google Drive.';
		} finally {
			synchronizing = false;
		}
	}

	onMount(() => {
		void refresh();
	});
</script>

<section class={`drive-card ${presentation.kind}`} aria-labelledby="drive-title">
	<div class="drive-copy">
		<div class="heading-row">
			<div>
				<p class="eyebrow">Armazenamento permanente</p>
				<h2 id="drive-title">Google Drive</h2>
			</div>
			<span class="status" aria-live="polite">
				{loading ? 'Carregando…' : synchronizing ? 'Sincronizando…' : presentation.title}
			</span>
		</div>

		<p>{presentation.detail}</p>
		<p class="privacy-note">
			O Fichário usa somente <code>drive.file</code>. Refresh tokens ficam no backend; o navegador
			não os armazena.
		</p>
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
		<Button
			label={loading ? 'Atualizando…' : 'Atualizar estado'}
			variant="secondary"
			disabled={loading || connecting || synchronizing}
			onclick={() => void refresh()}
		/>
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

	.privacy-note {
		font-size: 0.88rem;
	}

	code {
		padding: 0.1rem 0.25rem;
		border-radius: 0.3rem;
		background: var(--surface-strong);
		color: var(--ink);
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
