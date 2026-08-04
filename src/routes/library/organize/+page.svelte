<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { DocumentSummary } from '$lib/domain/document';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { updateDocumentOrganization } from '$lib/services/document-organization';
	import { listAllDocuments } from '$lib/services/documents';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';

	type EditableDocument = {
		document: DocumentSummary;
		title: string;
		notebookId: string;
		saving: boolean;
		saved: boolean;
		error: string | null;
	};

	const documentRequests = new RequestVersion();
	const notebookRequests = new RequestVersion();
	let rows = $state<EditableDocument[]>([]);
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let loading = $state(true);
	let notebookOptionsReady = $state(false);
	let notebookLoading = $state(true);
	let error = $state<string | null>(null);
	let notebookError = $state<string | null>(null);

	function rowForDocument(document: DocumentSummary): EditableDocument {
		return {
			document,
			title: document.title,
			notebookId: document.notebookId ?? '',
			saving: false,
			saved: false,
			error: null
		};
	}

	async function loadDocuments(version = documentRequests.next()) {
		loading = true;
		error = null;
		try {
			const documents = await listAllDocuments();
			if (!documentRequests.isCurrent(version)) return;
			rows = documents.map(rowForDocument);
		} catch (caught) {
			if (documentRequests.isCurrent(version)) {
				error =
					caught instanceof Error ? caught.message : 'Não foi possível carregar a organização.';
			}
		} finally {
			if (documentRequests.isCurrent(version)) loading = false;
		}
	}

	async function loadNotebookOptions(version = notebookRequests.next()) {
		notebookLoading = true;
		notebookOptionsReady = false;
		notebookError = null;
		try {
			const loadedNotebooks = await listNotebooks();
			if (!notebookRequests.isCurrent(version)) return;
			notebooks = loadedNotebooks;
			notebookOptionsReady = true;
		} catch {
			if (notebookRequests.isCurrent(version)) {
				notebookError = 'Não foi possível carregar os cadernos para organização.';
			}
		} finally {
			if (notebookRequests.isCurrent(version)) notebookLoading = false;
		}
	}

	function changed(row: EditableDocument) {
		row.saved = false;
		row.error = null;
	}

	async function save(row: EditableDocument) {
		if (row.saving) return;
		row.saving = true;
		row.saved = false;
		row.error = null;
		try {
			const updated = await updateDocumentOrganization(row.document.id, {
				title: row.title,
				notebookId: notebookOptionsReady ? row.notebookId || null : row.document.notebookId
			});
			row.title = updated.title;
			row.notebookId = updated.notebookId ?? '';
			row.document = Object.freeze({
				...row.document,
				title: updated.title,
				notebookId: updated.notebookId,
				updatedAt: updated.updatedAt
			});
			row.saved = true;
		} catch (caught) {
			row.error = caught instanceof Error ? caught.message : 'Não foi possível salvar.';
		} finally {
			row.saving = false;
		}
	}

	onMount(() => {
		void loadDocuments();
		void loadNotebookOptions();
	});

	onDestroy(() => {
		documentRequests.next();
		notebookRequests.next();
	});
</script>

<svelte:head>
	<title>Organizar documentos — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Metadados em lote</p>
		<h1 id="page-title">Organizar documentos</h1>
		<p>
			Renomeie e mova documentos entre cadernos sem alterar páginas, arquivos, tags ou histórico.
		</p>
	</header>

	{#if notebookError}
		<div class="notebook-warning" role="status">
			<p>{notebookError}</p>
			<button type="button" disabled={notebookLoading} onclick={() => void loadNotebookOptions()}>
				{notebookLoading ? 'Carregando…' : 'Tentar novamente'}
			</button>
		</div>
	{/if}

	{#if loading}
		<p class="loading" role="status">Carregando documentos…</p>
	{:else if error}
		<div class="fatal" role="alert">
			<p>{error}</p>
			<button type="button" onclick={() => void loadDocuments()}>Tentar novamente</button>
		</div>
	{:else if rows.length === 0}
		<EmptyState
			title="Nenhum documento para organizar"
			description="Importe imagens ou PDFs e volte aqui para ajustar título e caderno."
		/>
	{:else}
		<section class="documents" aria-label="Organização dos documentos">
			{#each rows as row (row.document.id)}
				<article>
					<div class={`kind ${row.document.kind}`} aria-hidden="true">
						{row.document.kind === 'pdf' ? 'PDF' : 'IMG'}
					</div>
					<div class="fields">
						<label>
							<span>Título</span>
							<input
								bind:value={row.title}
								disabled={row.saving}
								maxlength="240"
								oninput={() => changed(row)}
							/>
						</label>
						<label>
							<span>Caderno</span>
							<select
								bind:value={row.notebookId}
								disabled={row.saving || !notebookOptionsReady}
								onchange={() => changed(row)}
							>
								<option value="">Sem caderno</option>
								{#each notebooks as notebook}
									<option value={notebook.id}>{notebook.name}</option>
								{/each}
							</select>
						</label>
					</div>
					<div class="actions">
						<span class:problem={row.error !== null} role="status">
							{row.error ?? (row.saved ? 'Salvo' : '')}
						</span>
						<a href={`/documents/${row.document.id}/`}>Abrir</a>
						<button
							type="button"
							disabled={row.saving || !row.title.trim()}
							onclick={() => void save(row)}
						>
							{row.saving ? 'Salvando…' : 'Salvar'}
						</button>
					</div>
				</article>
			{/each}
		</section>
	{/if}
</div>

<style>
	.page,
	.documents {
		display: grid;
		gap: 0.8rem;
	}

	.eyebrow {
		margin-bottom: 0.4rem;
		color: var(--archive);
		font-size: 0.73rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-family: var(--font-heading);
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		font-weight: 540;
		letter-spacing: -0.04em;
	}

	header p:last-child {
		max-width: 52rem;
		margin: 0 0 0.5rem;
		color: var(--muted);
	}

	article {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr) auto;
		align-items: end;
		gap: 0.9rem;
		padding: 0.85rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.kind {
		width: 3.5rem;
		height: 4rem;
		display: grid;
		place-items: center;
		border-radius: 0.3rem;
		background: var(--archive);
		color: white;
		font-size: 0.68rem;
		font-weight: 820;
		letter-spacing: 0.08em;
	}

	.kind.pdf {
		background: var(--accent);
	}

	.fields {
		display: grid;
		grid-template-columns: minmax(12rem, 1fr) minmax(10rem, 0.45fr);
		gap: 0.65rem;
	}

	label {
		display: grid;
		gap: 0.3rem;
	}

	label span {
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 720;
	}

	input,
	select {
		width: 100%;
		min-height: 2.65rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.actions {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.4rem;
		justify-items: end;
	}

	.actions > span {
		grid-column: 1 / -1;
		max-width: 16rem;
		color: var(--archive);
		font-size: 0.7rem;
		text-align: right;
	}

	.actions > span.problem {
		color: var(--danger);
	}

	.actions a,
	.actions button,
	.fatal button,
	.notebook-warning button {
		min-height: 2.4rem;
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-size: 0.76rem;
		font-weight: 720;
		cursor: pointer;
	}

	.actions button {
		border-color: var(--archive);
		background: var(--archive);
		color: white;
	}

	.loading {
		padding: 3rem;
		color: var(--muted);
		text-align: center;
	}

	.notebook-warning,
	.fatal {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
	}

	.notebook-warning {
		border-left-color: var(--accent);
		background: rgb(166 94 67 / 7%);
	}

	.notebook-warning p,
	.fatal p {
		margin: 0;
	}

	.notebook-warning p {
		color: var(--accent-strong);
	}

	.fatal p {
		color: var(--danger);
	}

	@media (max-width: 880px) {
		article {
			grid-template-columns: 3.5rem minmax(0, 1fr);
		}

		.actions {
			grid-column: 1 / -1;
			display: flex;
			align-items: center;
			justify-content: flex-end;
		}

		.actions > span {
			margin-right: auto;
			text-align: left;
		}
	}

	@media (max-width: 600px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>
