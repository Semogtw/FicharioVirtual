<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CorrectionEditor from '$lib/components/CorrectionEditor.svelte';
	import type { PageDetail } from '$lib/domain/page';
	import { deleteDocument } from '$lib/services/documents';
	import {
		loadDocumentDetail,
		type DocumentDetail
	} from '$lib/services/document-detail';
	import { resumeDocumentOcr } from '$lib/services/ocr-resume';

	let detail = $state<DocumentDetail | null>(null);
	let selectedPageNumber = $state(Number(page.url.searchParams.get('page') ?? '1'));
	let loading = $state(true);
	let retrying = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	const highlightedQuery = page.url.searchParams.get('highlight')?.slice(0, 200) ?? '';

	let selectedPage = $derived(
		detail?.pages.find((candidate) => candidate.pageNumber === selectedPageNumber) ??
			detail?.pages[0] ??
			null
	);

	async function refresh() {
		loading = true;
		error = null;
		try {
			detail = await loadDocumentDetail(page.params.id);
			if (!detail.pages.some((candidate) => candidate.pageNumber === selectedPageNumber)) {
				selectedPageNumber = detail.pages[0]?.pageNumber ?? 1;
			}
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível abrir este documento.';
		} finally {
			loading = false;
		}
	}

	function pageSaved(saved: PageDetail) {
		if (!detail) return;
		detail = Object.freeze({
			...detail,
			pages: Object.freeze(
				detail.pages.map((candidate) => (candidate.id === saved.id ? saved : candidate))
			)
		});
	}

	async function retryOcr() {
		if (!detail || retrying) return;
		retrying = true;
		error = null;
		try {
			await resumeDocumentOcr(detail.id);
			await refresh();
		} catch {
			error = 'Algumas páginas ainda não puderam ser retomadas.';
		} finally {
			retrying = false;
		}
	}

	async function removeDocument() {
		if (!detail || deleting) return;
		if (!window.confirm(`Excluir “${detail.title}” e todos os arquivos associados?`)) return;
		deleting = true;
		error = null;
		try {
			await deleteDocument(detail.id);
			await goto('/library/');
		} catch {
			error = 'Não foi possível excluir o documento agora.';
			deleting = false;
		}
	}

	onMount(() => {
		void refresh();
	});
</script>

<svelte:head>
	<title>{detail?.title ?? 'Documento'} — Fichário Virtual</title>
</svelte:head>

<div class="page">
	<a class="back" href="/library/">← Biblioteca</a>

	{#if loading}
		<p class="loading" role="status">Abrindo o documento privado…</p>
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
				<p>{detail.pageCount} {detail.pageCount === 1 ? 'página' : 'páginas'} · {detail.originalFilename}</p>
			</div>
			<div class="header-actions">
				{#if ['processing', 'partially_ready', 'needs_review', 'failed'].includes(detail.status)}
					<button type="button" class="secondary" disabled={retrying} onclick={() => void retryOcr()}>
						{retrying ? 'Retomando…' : 'Retomar leitura'}
					</button>
				{/if}
				<button type="button" class="danger" disabled={deleting} onclick={() => void removeDocument()}>
					{deleting ? 'Excluindo…' : 'Excluir'}
				</button>
			</div>
		</header>

		{#if highlightedQuery}
			<p class="search-context">
				Aberto a partir da busca por <strong>“{highlightedQuery}”</strong>.
			</p>
		{/if}
		{#if error}<p class="inline-error" role="alert">{error}</p>{/if}

		{#if detail.pages.length > 1}
			<nav class="page-strip" aria-label="Páginas do documento">
				{#each detail.pages as item}
					<button
						type="button"
						class:active={item.pageNumber === selectedPage?.pageNumber}
						onclick={() => (selectedPageNumber = item.pageNumber)}
					>
						<span>{item.pageNumber}</span>
						<small>{item.status === 'needs_review' ? 'Revisar' : item.status}</small>
					</button>
				{/each}
			</nav>
		{/if}

		{#if selectedPage}
			<section class="reader" aria-label={`Página ${selectedPage.pageNumber}`}>
				<div class="original-panel">
					<div class="panel-heading">
						<h2>Original</h2>
						<a href={detail.originalUrl} target="_blank" rel="noreferrer">Abrir em nova aba</a>
					</div>
					<div class="viewer">
						{#if detail.kind === 'image'}
							<img src={detail.originalUrl} alt={`Original de ${detail.title}`} />
						{:else}
							<iframe
								src={`${detail.originalUrl}#page=${selectedPage.pageNumber}&zoom=page-width`}
								title={`Página ${selectedPage.pageNumber} do PDF ${detail.title}`}
							></iframe>
						{/if}
					</div>
				</div>

				{#key selectedPage.id}
					<CorrectionEditor page={selectedPage} onSaved={pageSaved} />
				{/key}
			</section>
		{/if}
	{/if}
</div>

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
		display: grid;
		grid-template-columns: minmax(20rem, 1fr) minmax(22rem, 1fr);
		gap: 1rem;
		align-items: stretch;
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

	.viewer {
		min-height: 28rem;
		display: grid;
		place-items: center;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #d8d6d0;
	}

	.viewer img {
		max-width: 100%;
		max-height: 72vh;
		object-fit: contain;
	}

	.viewer iframe {
		width: 100%;
		height: 72vh;
		min-height: 32rem;
		border: 0;
		background: white;
	}

	.loading {
		padding: 4rem;
		color: var(--muted);
		text-align: center;
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

	@media (max-width: 980px) {
		.reader {
			grid-template-columns: 1fr;
		}
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
