<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import DocumentCard from '$lib/components/DocumentCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import NotebookBanner from '$lib/components/NotebookBanner.svelte';
	import type { DocumentSummary } from '$lib/domain/document';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { updateDocumentOrganization } from '$lib/services/document-organization';
	import { listAllDocuments } from '$lib/services/documents';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';

	const notebookRequests = new RequestVersion();
	const documentRequests = new RequestVersion();
	const libraryRequests = new RequestVersion();
	let notebook = $state<NotebookSummary | null>(null);
	let documents = $state<readonly DocumentSummary[]>([]);
	let libraryDocuments = $state<readonly DocumentSummary[]>([]);
	let loading = $state(true);
	let documentsLoading = $state(false);
	let libraryLoading = $state(false);
	let showLibraryPicker = $state(false);
	let libraryQuery = $state('');
	let attachingIds = $state<string[]>([]);
	let error = $state<string | null>(null);
	let documentsError = $state<string | null>(null);
	let libraryError = $state<string | null>(null);
	let availableLibraryDocuments = $derived.by(() => {
		const notebookId = notebook?.id;
		const normalizedQuery = libraryQuery.trim().toLocaleLowerCase('pt-BR');
		return libraryDocuments.filter((document) => {
			if (document.notebookId === notebookId) return false;
			return (
				normalizedQuery.length === 0 ||
				document.title.toLocaleLowerCase('pt-BR').includes(normalizedQuery)
			);
		});
	});

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

	async function loadLibrary(version = libraryRequests.next()) {
		libraryLoading = true;
		libraryError = null;
		try {
			const loadedDocuments = await listAllDocuments();
			if (!libraryRequests.isCurrent(version)) return;
			libraryDocuments = loadedDocuments;
		} catch {
			if (libraryRequests.isCurrent(version)) {
				libraryDocuments = Object.freeze([]);
				libraryError = 'Não foi possível abrir a biblioteca agora.';
			}
		} finally {
			if (libraryRequests.isCurrent(version)) libraryLoading = false;
		}
	}

	function openLibraryPicker() {
		showLibraryPicker = true;
		libraryQuery = '';
		void loadLibrary();
	}

	async function attachDocument(document: DocumentSummary) {
		if (!notebook || attachingIds.includes(document.id)) return;
		const notebookId = notebook.id;
		attachingIds = [...attachingIds, document.id];
		libraryError = null;
		try {
			await updateDocumentOrganization(document.id, {
				title: document.title,
				notebookId
			});
			libraryDocuments = libraryDocuments.map((candidate) =>
				candidate.id === document.id
					? Object.freeze({ ...candidate, notebookId, updatedAt: new Date().toISOString() })
					: candidate
			);
			await loadDocuments(notebookId);
		} catch {
			libraryError = 'Não foi possível adicionar este documento ao caderno.';
		} finally {
			attachingIds = attachingIds.filter((id) => id !== document.id);
		}
	}

	async function initialize(notebookId: string, version = notebookRequests.next()) {
		loading = true;
		error = null;
		documentRequests.next();
		libraryRequests.next();
		documents = Object.freeze([]);
		libraryDocuments = Object.freeze([]);
		documentsLoading = false;
		libraryLoading = false;
		showLibraryPicker = false;
		libraryQuery = '';
		attachingIds = [];
		documentsError = null;
		libraryError = null;
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
		libraryRequests.next();
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
			<div class="header-actions">
				<button type="button" class="secondary-action" onclick={openLibraryPicker}>
					Da biblioteca
				</button>
				<a class="primary-action" href={`/import/?notebook=${notebook.id}`}>Importar novo</a>
			</div>
		</header>

		{#if showLibraryPicker}
			<section class="library-picker" aria-labelledby="library-picker-title">
				<div class="picker-heading">
					<div>
						<p class="eyebrow">Biblioteca</p>
						<h2 id="library-picker-title">Adicionar documento existente</h2>
						<p>
							Escolha um arquivo que já está no Fichário. Se ele estiver em outro caderno, será
							movido para este.
						</p>
					</div>
					<button type="button" class="close-picker" onclick={() => (showLibraryPicker = false)}>
						Fechar
					</button>
				</div>

				<label class="search-field">
					<span>Buscar na biblioteca</span>
					<input bind:value={libraryQuery} type="search" placeholder="Digite o nome do documento" />
				</label>

				{#if libraryError}<p class="picker-error" role="alert">{libraryError}</p>{/if}
				{#if libraryLoading}
					<p class="picker-status" role="status">Carregando biblioteca…</p>
				{:else if availableLibraryDocuments.length === 0}
					<p class="picker-status">
						{libraryQuery.trim()
							? 'Nenhum documento corresponde à busca.'
							: 'Todos os documentos da biblioteca já estão neste caderno.'}
					</p>
				{:else}
					<ul class="library-list">
						{#each availableLibraryDocuments as document (document.id)}
							<li>
								<div>
									<strong>{document.title}</strong>
									<small>
										{document.kind === 'pdf' ? 'PDF' : 'Imagem'} · {document.pageCount}
										{document.pageCount === 1 ? ' página' : ' páginas'}
										{document.notebookId ? ' · em outro caderno' : ' · sem caderno'}
									</small>
								</div>
								<button
									type="button"
									disabled={attachingIds.includes(document.id)}
									onclick={() => void attachDocument(document)}
								>
									{attachingIds.includes(document.id) ? 'Adicionando…' : 'Adicionar'}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

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
				description="Adicione um documento existente da biblioteca ou importe um arquivo novo diretamente para este caderno."
				actionLabel="Adicionar da biblioteca"
				onAction={openLibraryPicker}
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

	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 520;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-size: clamp(2.5rem, 7vw, 5rem);
		letter-spacing: -0.045em;
	}

	h2 {
		margin: 0;
		font-size: clamp(1.55rem, 4vw, 2.1rem);
		letter-spacing: -0.025em;
	}

	header p:last-child,
	.picker-heading p:last-child {
		margin-bottom: 0;
		color: var(--muted);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex: 0 0 auto;
	}

	.primary-action,
	.secondary-action,
	.close-picker,
	.library-list button {
		min-height: 2.8rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.7rem 1rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		font: inherit;
		font-weight: 740;
		cursor: pointer;
	}

	.primary-action {
		border-color: var(--archive);
		background: var(--archive);
		color: white;
	}

	.secondary-action,
	.close-picker {
		background: var(--surface-strong);
		color: var(--ink);
	}

	.library-picker {
		display: grid;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.picker-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.picker-heading > div {
		display: grid;
		gap: 0.35rem;
	}

	.search-field {
		display: grid;
		gap: 0.35rem;
	}

	.search-field span {
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 720;
	}

	.search-field input {
		min-height: 2.8rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font: inherit;
	}

	.library-list {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		list-style: none;
		overflow: hidden;
	}

	.library-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.8rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface-strong);
	}

	.library-list li:last-child {
		border-bottom: 0;
	}

	.library-list li > div {
		min-width: 0;
		display: grid;
		gap: 0.18rem;
	}

	.library-list strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.library-list small {
		color: var(--muted);
	}

	.library-list button {
		min-height: 2.45rem;
		padding: 0.55rem 0.75rem;
		background: var(--archive-soft);
		color: var(--archive);
	}

	.library-list button:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	.picker-error,
	.picker-status {
		margin: 0;
		padding: 0.75rem;
	}

	.picker-error {
		color: var(--danger);
		background: rgb(155 63 54 / 7%);
	}

	.picker-status {
		color: var(--muted);
		text-align: center;
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

	@media (max-width: 680px) {
		header,
		.picker-heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.header-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.primary-action,
		.secondary-action {
			flex: 1;
		}

		.library-list li {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
