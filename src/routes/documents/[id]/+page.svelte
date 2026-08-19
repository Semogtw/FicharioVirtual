<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DocumentMediaViewer from '$lib/components/DocumentMediaViewer.svelte';
	import { deleteDocument } from '$lib/services/documents';
	import {
		invalidateDocumentDetail,
		loadDocumentDetail,
		type DocumentDetail
	} from '$lib/services/document-detail';
	import { resumeDocumentOcr } from '$lib/services/ocr-resume';
	import { RequestVersion } from '$lib/services/request-version';

	let detail = $state<DocumentDetail | null>(null);
	let selectedPageNumber = $state(1);
	let loading = $state(true);
	let retrying = $state(false);
	let deleting = $state(false);
	let deleted = $state(false);
	let confirmDelete = $state(false);
	let error = $state<string | null>(null);
	let highlightedQuery = $derived(page.url.searchParams.get('highlight')?.slice(0, 200) ?? '');
	const refreshRequests = new RequestVersion();

	function pageStatusLabel(status: DocumentDetail['pages'][number]['status']) {
		switch (status) {
			case 'pending':
				return 'Na fila';
			case 'processing':
				return 'Processando';
			case 'retryable':
				return 'Aguardando';
			case 'blocked_quota':
				return 'Aguardando';
			case 'failed':
				return 'Falhou';
			case 'ready':
			case 'needs_review':
				return 'Pronta';
		}
	}

	async function refresh(
		documentId: string | undefined = page.params.id,
		requestedPageNumber = selectedPageNumber
	) {
		const version = refreshRequests.next();
		loading = true;
		error = null;
		if (!documentId) {
			if (refreshRequests.isCurrent(version)) {
				detail = null;
				error = 'Não foi possível abrir este documento.';
				loading = false;
			}
			return;
		}
		try {
			const loaded = await loadDocumentDetail(documentId);
			if (!refreshRequests.isCurrent(version)) return;
			detail = loaded;
			selectedPageNumber = loaded.pages.some(
				(candidate) => candidate.pageNumber === requestedPageNumber
			)
				? requestedPageNumber
				: (loaded.pages[0]?.pageNumber ?? 1);
		} catch (caught) {
			if (!refreshRequests.isCurrent(version)) return;
			detail = null;
			error = caught instanceof Error ? caught.message : 'Não foi possível abrir este documento.';
		} finally {
			if (refreshRequests.isCurrent(version)) loading = false;
		}
	}

	function selectPage(pageNumber: number) {
		if (!detail || pageNumber === selectedPageNumber) return;
		selectedPageNumber = pageNumber;
		error = null;
		requestAnimationFrame(() => {
			document
				.getElementById(`document-page-${pageNumber}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}

	async function retryOcr() {
		if (!detail || retrying || deleting) return;
		const documentId = detail.id;
		retrying = true;
		error = null;
		try {
			await resumeDocumentOcr(documentId);
			if (page.params.id !== documentId) return;
			invalidateDocumentDetail(documentId);
			await refresh(documentId, selectedPageNumber);
		} catch {
			if (page.params.id === documentId) {
				error = 'Algumas páginas ainda não puderam ser retomadas.';
			}
		} finally {
			if (page.params.id === documentId) retrying = false;
		}
	}

	async function removeDocument() {
		if (!detail || deleting || retrying) return;
		const documentId = detail.id;
		deleting = true;
		error = null;
		try {
			await deleteDocument(documentId);
		} catch {
			if (page.params.id === documentId) {
				error = 'Não foi possível excluir o documento agora.';
				deleting = false;
				confirmDelete = false;
			}
			return;
		}
		if (page.params.id !== documentId) return;
		invalidateDocumentDetail(documentId);
		confirmDelete = false;
		deleted = true;
		detail = null;
		try {
			await goto('/library/');
		} catch {
			if (page.params.id === documentId) {
				error = 'Documento excluído, mas não foi possível voltar à biblioteca.';
				deleting = false;
			}
		}
	}

	$effect(() => {
		const documentId = page.params.id;
		const requestedPage = Number(page.url.searchParams.get('page') ?? '1');
		const pageNumber = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
		detail = null;
		selectedPageNumber = pageNumber;
		retrying = false;
		deleting = false;
		deleted = false;
		confirmDelete = false;
		void refresh(documentId, pageNumber);
	});
</script>

<svelte:head>
	<title>{detail?.title ?? 'Documento'} — Fichário Virtual</title>
</svelte:head>

<div class="page">
	<a class="back" href="/library/">← Biblioteca</a>

	{#if loading}
		<p class="loading" role="status">Abrindo o documento…</p>
	{:else if deleted}
		<div class="deleted" role="status">
			<p>O documento foi excluído.</p>
			{#if error}<p class="deleted-error">{error}</p>{/if}
			<a href="/library/">Voltar à biblioteca</a>
		</div>
	{:else if error && !detail}
		<div class="fatal" role="alert">
			<p>{error}</p>
			<button type="button" onclick={() => void refresh()}>Tentar novamente</button>
		</div>
	{:else if detail}
		<header>
			<div>
				<p class="eyebrow">{detail.kind === 'pdf' ? 'Documento PDF' : 'Imagem'}</p>
				<h1>{detail.title}</h1>
				<p>
					{detail.pageCount}
					{detail.pageCount === 1 ? 'página' : 'páginas'} · {detail.originalFilename}
				</p>
			</div>
			<div class="header-actions">
				{#if ['processing', 'partially_ready', 'failed'].includes(detail.status)}
					<button
						type="button"
						class="secondary"
						disabled={retrying || deleting}
						onclick={() => void retryOcr()}
					>
						{retrying ? 'Retomando…' : 'Retomar leitura'}
					</button>
				{/if}
				<button
					type="button"
					class="danger"
					disabled={deleting || retrying}
					onclick={() => (confirmDelete = true)}
				>
					Excluir
				</button>
			</div>
		</header>

		{#if highlightedQuery}
			<p class="search-context">
				Aberto a partir da busca por <strong>“{highlightedQuery}”</strong>. A correspondência é
				marcada diretamente no documento.
			</p>
		{/if}
		{#if error}<p class="inline-error" role="alert">{error}</p>{/if}

		{#if detail.pages.length > 1}
			<nav class="page-strip" aria-label="Páginas do documento">
				{#each detail.pages as item}
					<button
						type="button"
						class:active={item.pageNumber === selectedPageNumber}
						aria-pressed={item.pageNumber === selectedPageNumber}
						onclick={() => selectPage(item.pageNumber)}
					>
						<span>{item.pageNumber}</span>
						<small>{pageStatusLabel(item.status)}</small>
					</button>
				{/each}
			</nav>
		{/if}

		{#if detail.pages.length > 0}
			<section class="reader" aria-label="Documento completo">
				<div class="original-panel">
					<div class="panel-heading">
						<h2>Original</h2>
						{#if detail.originalReference.provider !== 'missing'}
							<a href={detail.originalReference.url} target="_blank" rel="noreferrer">
								{detail.originalReference.provider === 'google_drive'
									? 'Abrir no Google Drive'
									: 'Abrir em nova aba'}
							</a>
						{/if}
					</div>
					<div class="original-body">
						<DocumentMediaViewer
							{detail}
							pages={detail.pages}
							query={highlightedQuery}
							focusPageNumber={selectedPageNumber}
						/>
					</div>
				</div>
			</section>
		{/if}
	{/if}
</div>

<ConfirmDialog
	open={confirmDelete && detail !== null}
	title="Excluir documento?"
	description={detail
		? `“${detail.title}” e todos os arquivos associados serão removidos do Fichário.`
		: ''}
	confirmLabel="Excluir"
	busy={deleting}
	danger
	onConfirm={() => void removeDocument()}
	onCancel={() => (confirmDelete = false)}
/>

<style>
	.page {
		display: grid;
		gap: 1.15rem;
	}

	.back {
		width: fit-content;
		color: var(--archive);
		font-size: 0.86rem;
		font-weight: 720;
	}

	header,
	.panel-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}

	.eyebrow {
		margin-bottom: 0.35rem;
		color: var(--archive);
		font-size: 0.72rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 540;
	}

	h1 {
		margin-bottom: 0.4rem;
		font-size: clamp(2rem, 5vw, 3.7rem);
		letter-spacing: -0.04em;
	}

	header p:last-child {
		margin-bottom: 0;
		color: var(--muted);
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button,
	.panel-heading a {
		min-height: 2.55rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-weight: 720;
		cursor: pointer;
	}

	button.danger {
		border-color: rgb(155 63 54 / 35%);
		color: var(--danger);
	}

	.search-context,
	.inline-error {
		margin: 0;
		padding: 0.7rem 0.9rem;
		border-left: 0.25rem solid var(--archive);
		background: var(--archive-soft);
	}

	.inline-error {
		border-color: var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
	}

	.page-strip {
		display: flex;
		gap: 0.45rem;
		overflow-x: auto;
		padding-bottom: 0.2rem;
	}

	.page-strip button {
		min-width: 4.5rem;
		display: grid;
		gap: 0.1rem;
		padding: 0.45rem 0.65rem;
	}

	.page-strip button.active {
		border-color: var(--archive);
		background: var(--archive);
		color: white;
	}

	.page-strip small {
		font-size: 0.62rem;
		opacity: 0.75;
	}

	.reader {
		display: block;
	}

	.original-panel {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 0.8rem;
		min-height: 34rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.panel-heading h2 {
		margin: 0;
		font-size: 1.45rem;
	}

	.panel-heading a {
		min-height: 2.25rem;
		padding: 0.45rem 0.65rem;
		font-size: 0.76rem;
	}

	.original-body {
		position: relative;
		min-height: 28rem;
	}

	.loading {
		padding: 4rem;
		color: var(--muted);
		text-align: center;
	}

	.deleted {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--archive);
		background: var(--archive-soft);
	}

	.deleted p {
		margin: 0;
	}

	.deleted .deleted-error {
		color: var(--danger);
	}

	.deleted a {
		min-height: 2.55rem;
		display: inline-flex;
		align-items: center;
		padding: 0.6rem 0.85rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 720;
	}

	.fatal {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
	}

	.fatal p {
		margin: 0;
		color: var(--danger);
	}

	@media (max-width: 620px) {
		header {
			align-items: flex-start;
			flex-direction: column;
		}

		.header-actions {
			justify-content: flex-start;
		}
	}
</style>
