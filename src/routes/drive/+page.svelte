<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		listDriveRecovery,
		reconnectMissingDriveDocument,
		type DriveRecoveryState,
		type MissingDriveDocument,
		type OpenDriveConflict
	} from '$lib/drive/recovery';
	import { copyBrowserDriveFile, deleteBrowserDriveFile } from '$lib/drive/browser-files';
	import { isGooglePickerConfigured, selectGoogleDriveFile } from '$lib/drive/picker-service';
	import type { GooglePickerMimeType } from '$lib/drive/picker';
	import { resolveDriveFolder } from '$lib/drive/resolve-folder';
	import { getSupabaseClient } from '$lib/services/supabase';

	const client = getSupabaseClient();
	const pickerConfigured = isGooglePickerConfigured();
	let recovery = $state<DriveRecoveryState>({ missingDocuments: [], openConflicts: [] });
	let loading = $state(true);
	let busyId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);

	const conflictLabels: Record<OpenDriveConflict['kind'], string> = {
		ambiguous_order: 'Alterações feitas ao mesmo tempo',
		identity_mismatch: 'Arquivo diferente do esperado',
		remote_deleted_local_changed: 'Arquivo removido no Drive',
		local_deleted_remote_changed: 'Arquivo removido no Fichário'
	};

	function formatDate(value: string) {
		return new Intl.DateTimeFormat('pt-BR', {
			dateStyle: 'short',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function mimeTypesFor(document: MissingDriveDocument): readonly GooglePickerMimeType[] {
		return document.kind === 'pdf'
			? ['application/pdf']
			: ['image/jpeg', 'image/png', 'image/webp'];
	}

	async function load() {
		if (busyId !== null) return;
		loading = true;
		error = null;
		try {
			recovery = await listDriveRecovery(client as never);
		} catch {
			error = 'Não foi possível verificar o Google Drive agora.';
		} finally {
			loading = false;
		}
	}

	async function reconnect(document: MissingDriveDocument) {
		if (!pickerConfigured || loading || busyId !== null) return;
		busyId = document.id;
		error = null;
		message = null;
		let copiedFileId: string | null = null;
		try {
			const selection = await selectGoogleDriveFile({
				mimeTypes: mimeTypesFor(document),
				client: client as never
			});
			if (selection === null) return;
			const parentFolderId = await resolveDriveFolder(document.notebookId, client as never);
			const copied = await copyBrowserDriveFile({
				client: client as never,
				sourceFileId: selection.id,
				parentFolderId,
				name: document.originalFilename
			});
			copiedFileId = copied.id;
			try {
				await reconnectMissingDriveDocument(
					{ documentId: document.id, file: copied },
					client as never
				);
			} catch (caught) {
				await deleteBrowserDriveFile({
					client: client as never,
					fileId: copiedFileId
				}).catch(() => undefined);
				throw caught;
			}
			message = `“${document.title}” foi reconectado.`;
			busyId = null;
			await load();
		} catch {
			error = 'Não foi possível reconectar este arquivo.';
		} finally {
			busyId = null;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<svelte:head>
	<title>Google Drive — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Google Drive</p>
			<h1 id="page-title">Arquivos no Drive</h1>
			<p>Veja arquivos que precisam ser reconectados e resolva problemas de sincronização.</p>
		</div>
		<Button
			label={loading ? 'Atualizando…' : 'Atualizar'}
			variant="secondary"
			disabled={loading || busyId !== null}
			onclick={() => void load()}
		/>
	</header>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	{#if !pickerConfigured}
		<section class="notice" aria-labelledby="picker-required-title">
			<h2 id="picker-required-title">Seleção de arquivos indisponível</h2>
			<p>A seleção manual de arquivos do Google Drive ainda não está disponível.</p>
		</section>
	{/if}

	<section aria-labelledby="missing-title" class="panel">
		<div class="panel-heading">
			<div>
				<p class="eyebrow">Arquivos</p>
				<h2 id="missing-title">Arquivos ausentes</h2>
			</div>
			<span>{recovery.missingDocuments.length}</span>
		</div>

		{#if loading}
			<p class="empty" role="status">Verificando seus arquivos…</p>
		{:else if recovery.missingDocuments.length === 0}
			<p class="empty">Está tudo certo por aqui.</p>
		{:else}
			<ul class="recovery-list">
				{#each recovery.missingDocuments as document (document.id)}
					<li>
						<div>
							<strong>{document.title}</strong>
							<small>
								{document.kind === 'pdf' ? 'PDF' : 'Imagem'} · {document.originalFilename} · encontrado
								em {formatDate(document.updatedAt)}
							</small>
							<a href={`/documents/${document.id}/`}>Abrir documento</a>
						</div>
						<Button
							label={busyId === document.id ? 'Reconectando…' : 'Reconectar'}
							disabled={!pickerConfigured || busyId !== null}
							onclick={() => void reconnect(document)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="conflicts-title" class="panel">
		<div class="panel-heading">
			<div>
				<p class="eyebrow">Sincronização</p>
				<h2 id="conflicts-title">Itens com conflito</h2>
			</div>
			<span>{recovery.openConflicts.length}</span>
		</div>

		{#if loading}
			<p class="empty" role="status">Verificando a sincronização…</p>
		{:else if recovery.openConflicts.length === 0}
			<p class="empty">Nenhum conflito encontrado.</p>
		{:else}
			<ul class="conflict-list">
				{#each recovery.openConflicts as conflict (conflict.id)}
					<li>
						<strong>{conflictLabels[conflict.kind]}</strong>
						<small>Identificado em {formatDate(conflict.createdAt)}.</small>
						{#if conflict.documentId}
							<a href={`/documents/${conflict.documentId}/`}>Abrir documento</a>
						{:else if conflict.notebookId}
							<a href={`/notebooks/${conflict.notebookId}/`}>Abrir caderno</a>
						{/if}
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
	.recovery-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
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

	header p:last-child,
	.notice p {
		max-width: 54rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.panel,
	.notice {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.notice {
		border-left: 0.3rem solid var(--accent);
	}

	.notice h2,
	.panel h2 {
		margin: 0;
		font-size: 1.4rem;
	}

	.notice p {
		margin-top: 0.45rem;
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

	.recovery-list,
	.conflict-list {
		display: grid;
		gap: 0.7rem;
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	.recovery-list li,
	.conflict-list li {
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.recovery-list li > div,
	.conflict-list li {
		display: grid;
		gap: 0.3rem;
	}

	small,
	.empty {
		color: var(--muted);
		line-height: 1.45;
	}

	.recovery-list a,
	.conflict-list a {
		color: var(--archive);
		font-size: 0.86rem;
		font-weight: 720;
	}

	.empty {
		margin: 1rem 0 0;
		padding: 1rem;
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

	@media (max-width: 720px) {
		header,
		.recovery-list li {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
