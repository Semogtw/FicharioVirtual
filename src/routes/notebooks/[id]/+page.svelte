<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import DocumentCard from '$lib/components/DocumentCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import NotebookBanner from '$lib/components/NotebookBanner.svelte';
	import type { DocumentSummary } from '$lib/domain/document';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { listAllDocuments } from '$lib/services/documents';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';

	const notebookRequests = new RequestVersion();
	const documentRequests = new RequestVersion();
	let notebook = $state<NotebookSummary | null>(null);
	let documents = $state<readonly DocumentSummary[]>([]);
	let loading = $state(true);
	let documentsLoading = $state(false);
	let error = $state<string | null>(null);
	let documentsError = $state<string | null>(null);

	async function loadDocuments(notebookId: string, version = documentRequests.next()) {
		documentsLoading = true;
		documentsError = null;
		try {
			const loadedDocuments = await listAllDocuments({ filters: { notebookId } });
			if (!documentRequests.isCurrent(version)) return;
			documents = loadedDocuments;
		} catch {
			if (documentRequests.isCurrent(version)) {
				documents = Object.freeze([]);
				documentsError = 'Não foi possível carregar os documentos deste caderno.';
			}
		} finally {
			if (documentRequests.isCurrent(version)) documentsLoading = false;
		}
	}

	async function initialize(notebookId: string, version = notebookRequests.next()) {
		loading = true;
		error = null;
		documentRequests.next();
		documents = Object.freeze([]);
		documentsLoading = false;
		documentsError = null;
		try {
			const notebooks = await listNotebooks();
			if (!notebookRequests.isCurrent(version)) return;
			const loadedNotebook = notebooks.find((item) => item.id === notebookId) ?? null;
			notebook = loadedNotebook;
			if (!loadedNotebook) {
				error = 'Este caderno não existe ou não está disponível.';
				return;
			}
			void loadDocuments(notebookId);
		} catch {
			if (!notebookRequests.isCurrent(version)) return;
			notebook = null;
			error = 'Não foi possível abrir este caderno agora.';
		} finally {
			if (notebookRequests.isCurrent(version)) loading = false;
		}
	}

	function retryInitialize() {
		const notebookId = page.params.id;
		if (notebookId) void initialize(notebookId);
	}

	$effect(() => {
		const notebookId = page.params.id;
		notebook = null;
		documents = Object.freeze([]);
		if (!notebookId) {
			loading = false;
			error = 'Este caderno não existe ou não está disponível.';
			return;
		}
		void initialize(notebookId);
	});

	onDestroy(() => {
		notebookRequests.next();
		documentRequests.next();
	});
</script>

<svelte:head>
	<title>{notebook?.name ?? 'Caderno'} — Fichário Virtual</title>
</svelte:head>

<div class="page">
	<a class="back" href="/notebooks/">← Todos os cadernos</a>

	{#if loading}
		<p class="loading" role="status">Abrindo o caderno…</p>
	{:else if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<button type="button" onclick={retryInitialize}>Tentar novamente</button>
		</div>
	{:else if notebook}
		<NotebookBanner
			notebookId={notebook.id}
			bannerPath={notebook.bannerPath}
			bannerPositionX={notebook.bannerPositionX}
			bannerPositionY={notebook.bannerPositionY}
		/>

		<header>
			<div>
				<p class="eyebrow">Caderno</p>
				<h1>{notebook.name}</h1>
				<p>{notebook.description ?? 'Documentos reunidos neste caderno.'}</p>
			</div>
			<a class="primary-action" href={`/import/?notebook=${notebook.id}`}>Adicionar documento</a>
		</header>

		{#if documentsError}
			<div class="documents-error" role="status">
				<p>{documentsError}</p>
				<button
					type="button"
					disabled={documentsLoading}
					onclick={() => notebook && void loadDocuments(notebook.id)}
				>
					{documentsLoading ? 'Carregando…' : 'Tentar carregar documentos'}
				</button>
			</div>
		{:else if documentsLoading}
			<p class="loading" role="status">Carregando documentos do caderno…</p>
		{:else if documents.length === 0}
			<EmptyState
				title="Este caderno está vazio"
				description="Adicione um documento existente ou importe um novo arquivo diretamente para este caderno."
			/>
		{:else}
			<section class="grid" aria-label={`Documentos em ${notebook.name}`}>
				{#each documents as document (document.id)}
					<DocumentCard {document} />
				{/each}
			</section>
		{/if}
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1.5rem;
	}

	.back {
		width: fit-content;
		color: var(--archive);
		font-size: 0.86rem;
		font-weight: 720;
	}

	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--line);
	}

	.eyebrow {
		margin-bottom: 0.45rem;
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-family: var(--font-heading);
		font-size: clamp(2.5rem, 7vw, 5rem);
		font-weight: 520;
		letter-spacing: -0.045em;
	}

	header p:last-child {
		margin-bottom: 0;
		color: var(--muted);
	}

	.primary-action {
		min-height: 2.8rem;
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
		padding: 0.7rem 1rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 740;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
	}

	.loading {
		padding: 3rem;
		color: var(--muted);
		text-align: center;
	}

	.documents-error,
	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
	}

	.error p {
		margin: 0;
	}

	.documents-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-left-color: var(--accent);
		background: rgb(166 94 67 / 7%);
		color: var(--accent-strong);
	}

	.documents-error p {
		margin: 0;
	}

	.documents-error button,
	.error button {
		min-height: 2.45rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-weight: 720;
		cursor: pointer;
	}

	@media (max-width: 560px) {
		header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
