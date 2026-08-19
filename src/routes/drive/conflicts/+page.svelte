<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		listOpenDriveConflicts,
		resolveDriveConflict,
		type DriveConflictKind,
		type DriveConflictListItem,
		type DriveConflictResolution
	} from '$lib/services/drive-conflicts';

	let conflicts = $state<readonly DriveConflictListItem[]>([]);
	let loading = $state(true);
	let busyId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);

	const labels: Record<DriveConflictKind, string> = {
		ambiguous_order: 'Este item aparece em mais de um lugar no Drive',
		identity_mismatch: 'O arquivo no Drive não corresponde ao documento esperado',
		remote_deleted_local_changed: 'O original foi apagado no Drive, mas o Fichário tem mudanças mais recentes',
		local_deleted_remote_changed: 'O item foi removido do Fichário, mas mudou no Drive'
	};

	function formatDate(value: string) {
		return new Intl.DateTimeFormat('pt-BR', {
			dateStyle: 'short',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function load() {
		if (busyId !== null) return;
		loading = true;
		error = null;
		try {
			conflicts = await listOpenDriveConflicts();
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível carregar os conflitos do Google Drive.';
		} finally {
			loading = false;
		}
	}

	async function resolve(conflict: DriveConflictListItem, resolution: DriveConflictResolution) {
		if (busyId !== null || loading) return;
		busyId = conflict.id;
		error = null;
		message = null;
		try {
			await resolveDriveConflict(conflict.id, resolution);
			conflicts = conflicts.filter((item) => item.id !== conflict.id);
			message =
				resolution === 'retry_local'
					? 'As informações atuais do Fichário serão sincronizadas novamente com o Drive.'
					: 'O documento continua no Fichário e o original foi marcado como ausente.';
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível resolver o conflito do Google Drive.';
		} finally {
			busyId = null;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<svelte:head>
	<title>Conflitos do Drive — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Google Drive</p>
			<h1 id="page-title">Conflitos de sincronização</h1>
			<p>Escolha como resolver cada divergência sem afetar os demais arquivos do seu Fichário.</p>
		</div>
		<Button
			label={loading ? 'Atualizando…' : 'Atualizar'}
			variant="secondary"
			disabled={loading || busyId !== null}
			onclick={() => void load()}
		/>
	</header>

	<section class="policy" aria-labelledby="policy-title">
		<h2 id="policy-title">O que você pode fazer</h2>
		<ul>
			<li>
				<strong>Tentar novamente:</strong> usa as informações atuais do Fichário para sincronizar o item outra vez.
			</li>
			<li>
				<strong>Manter sem o original:</strong> quando o arquivo foi apagado no Drive, mantém texto, correções e organização disponíveis no Fichário.
			</li>
		</ul>
	</section>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	<section class="panel" aria-labelledby="conflicts-title">
		<div class="panel-heading">
			<div>
				<p class="eyebrow">Precisa da sua atenção</p>
				<h2 id="conflicts-title">Conflitos pendentes</h2>
			</div>
			<span>{conflicts.length}</span>
		</div>

		{#if loading}
			<p class="empty" role="status">Carregando conflitos…</p>
		{:else if conflicts.length === 0}
			<p class="empty">Nenhum conflito aguarda resolução.</p>
		{:else}
			<ul class="conflict-list">
				{#each conflicts as conflict (conflict.id)}
					<li>
						<div class="conflict-copy">
							<strong>{labels[conflict.kind]}</strong>
							<small>
								{conflict.documentId ? 'Documento' : 'Caderno'} · identificado em
								{formatDate(conflict.createdAt)}
							</small>
							{#if conflict.documentId}
								<a href={`/documents/${conflict.documentId}/`}>Abrir documento relacionado</a>
							{:else if conflict.notebookId}
								<a href={`/notebooks/${conflict.notebookId}/`}>Abrir caderno relacionado</a>
							{/if}
						</div>
						<div class="actions">
							<Button
								label={busyId === conflict.id ? 'Tentando novamente…' : 'Tentar novamente'}
								disabled={busyId !== null}
								onclick={() => void resolve(conflict, 'retry_local')}
							/>
							{#if conflict.kind === 'remote_deleted_local_changed' && conflict.documentId}
								<Button
									label={busyId === conflict.id ? 'Aplicando…' : 'Manter sem o original'}
									variant="secondary"
									disabled={busyId !== null}
									onclick={() => void resolve(conflict, 'mark_missing')}
								/>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: 1.25rem;
	}

	header,
	.panel-heading,
	.conflict-list li,
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	header {
		align-items: end;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--archive);
		font-size: 0.74rem;
		font-weight: 780;
		letter-spacing: 0.11em;
		text-transform: uppercase;
	}

	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 540;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header p:last-child {
		max-width: 58rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.policy,
	.panel {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.policy {
		border-left: 0.3rem solid var(--archive);
	}

	.policy h2,
	.panel h2 {
		margin: 0;
	}

	.policy ul {
		display: grid;
		gap: 0.45rem;
		margin: 0.65rem 0 0;
		padding-left: 1.2rem;
		color: var(--muted);
		line-height: 1.5;
	}

	.panel-heading > span {
		min-width: 2rem;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		background: var(--archive-soft);
		color: var(--archive);
		font-weight: 780;
		text-align: center;
	}

	.conflict-list {
		display: grid;
		gap: 0.7rem;
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	.conflict-list li {
		padding: 0.85rem;
		border: 1px solid var(--line);
		border-left: 0.3rem solid var(--danger);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.conflict-copy {
		display: grid;
		gap: 0.3rem;
	}

	.conflict-copy small {
		color: var(--muted);
	}

	.conflict-copy a {
		color: var(--archive);
		font-size: 0.86rem;
		font-weight: 720;
	}

	.actions {
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.empty {
		margin: 1rem 0 0;
		padding: 1rem;
		color: var(--muted);
		text-align: center;
	}

	.error,
	.message {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(var(--danger-rgb) / 7%);
		color: var(--danger);
	}

	.message {
		border-color: var(--archive);
		background: var(--archive-soft);
		color: var(--archive);
	}

	@media (max-width: 760px) {
		header,
		.conflict-list li {
			align-items: stretch;
			flex-direction: column;
		}

		.actions {
			justify-content: stretch;
		}
	}
</style>
