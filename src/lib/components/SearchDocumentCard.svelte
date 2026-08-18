<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import DocumentMediaViewer from '$lib/components/DocumentMediaViewer.svelte';
	import type { PageDetail } from '$lib/domain/page';
	import { countExactQueryOccurrences } from '$lib/search/document-search-results';
	import { resultHighlightQuery, searchResultHref } from '$lib/search/search-result-presentation';
	import {
		loadDocumentPreview,
		type DocumentDetail,
		type DocumentPageSummary
	} from '$lib/services/document-detail';
	import type { SemanticSearchResult } from '$lib/services/semantic-search';

	interface SearchDocumentCardProps {
		result: SemanticSearchResult;
		query: string;
	}

	const EMPTY_PREVIEW_PAGES = Object.freeze([]) as readonly DocumentPageSummary[];

	let { result, query }: SearchDocumentCardProps = $props();
	let host = $state<HTMLElement | null>(null);
	let detail = $state<DocumentDetail | null>(null);
	let previewPageDetail = $state<PageDetail | null>(null);
	let failed = $state(false);
	let generation = 0;

	let previewPage = $derived(
		detail?.pages.find((page) => page.pageNumber === result.pageNumber) ?? null
	);
	let previewPages = $derived(
		previewPage
			? (Object.freeze([previewPage]) as readonly DocumentPageSummary[])
			: EMPTY_PREVIEW_PAGES
	);
	let previewQuery = $derived(resultHighlightQuery(result.matchMode, query));
	let occurrenceCount = $derived(
		previewPageDetail && previewQuery
			? countExactQueryOccurrences(previewPageDetail.text, previewQuery)
			: 0
	);
	let href = $derived(
		searchResultHref(result.documentId, result.pageNumber, result.matchMode, query)
	);
	let occurrenceLabel = $derived(
		occurrenceCount === 1
			? '1 ocorrência nesta página'
			: `${occurrenceCount} ocorrências nesta página`
	);
	let matchLabel = $derived.by(() => {
		if (result.matchMode === 'visual') return 'Pela página';
		if (result.matchMode === 'semantic') return 'Por sentido';
		if (result.matchMode === 'hybrid') return 'Texto + sentido';
		if (result.matchMode === 'lexical_visual') return 'Texto + página';
		if (result.matchMode === 'semantic_visual') return 'Sentido + página';
		if (result.matchMode === 'hybrid_visual') return 'Texto + sentido + página';
		return null;
	});

	async function loadPreview() {
		if (detail || failed) return;
		const expectedGeneration = ++generation;
		try {
			const preview = await loadDocumentPreview(result.documentId, result.pageNumber);
			if (expectedGeneration !== generation) return;
			detail = preview.detail;
			previewPageDetail = preview.page;
		} catch {
			if (expectedGeneration === generation) failed = true;
		}
	}

	onMount(() => {
		const element = host;
		if (!element || typeof IntersectionObserver === 'undefined') {
			void loadPreview();
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void loadPreview();
			},
			{ rootMargin: '180px 0px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	});

	onDestroy(() => {
		generation += 1;
	});
</script>

<article class="document-result" bind:this={host}>
	<a {href}>
		<div class="preview" aria-busy={!detail && !failed}>
			{#if detail && previewPage}
				<DocumentMediaViewer
					{detail}
					pages={previewPages}
					query={previewQuery}
					focusPageNumber={result.pageNumber}
					initialPageDetail={previewPageDetail ?? undefined}
				/>
			{:else if failed}
				<div class="preview-state error" role="status">Não foi possível carregar a prévia.</div>
			{:else}
				<div class="preview-state" role="status">Carregando documento…</div>
			{/if}

			<div class="badges" role="group" aria-label="Detalhes da correspondência">
				{#if occurrenceCount > 0}
					<span class="occurrences">{occurrenceLabel}</span>
				{:else if matchLabel}
					<span>{matchLabel}</span>
				{:else if detail}
					<span>Correspondência aproximada</span>
				{/if}
				<span>Página {result.pageNumber}</span>
			</div>
		</div>
		<div class="result-copy">
			<h3>{result.documentTitle}</h3>
			<p>
				Página {result.pageNumber}
				{#if matchLabel}
					· {matchLabel}{/if}
			</p>
			{#if result.notebookName}<span class="notebook">{result.notebookName}</span>{/if}
		</div>
	</a>
</article>

<style>
	.document-result {
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
		overflow: hidden;
		transition:
			transform var(--motion-fast) var(--ease-standard),
			border-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-fast) var(--ease-standard);
	}

	a {
		display: grid;
		gap: 0;
		color: inherit;
	}

	.preview {
		position: relative;
		min-height: 18rem;
		background: #d8d6d0;
		overflow: hidden;
	}

	.preview-state {
		min-height: 18rem;
		display: grid;
		place-items: center;
		padding: 1rem;
		color: var(--muted);
		text-align: center;
	}

	.preview-state.error {
		color: var(--danger);
	}

	.badges {
		position: absolute;
		right: 0.6rem;
		bottom: 0.6rem;
		left: 0.6rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		pointer-events: none;
	}

	.badges span,
	.notebook {
		width: fit-content;
		padding: 0.3rem 0.55rem;
		border: 1px solid rgb(var(--ink-rgb) / 14%);
		border-radius: 999px;
		background: rgb(var(--surface-rgb) / 92%);
		box-shadow: 0 0.2rem 0.75rem rgb(var(--ink-rgb) / 10%);
		color: var(--muted-strong);
		font-size: 0.72rem;
		font-weight: 720;
		backdrop-filter: blur(7px);
	}

	.badges .occurrences {
		background: rgb(var(--archive-rgb) / 92%);
		color: white;
	}

	.notebook {
		display: inline-block;
		margin-top: 0.55rem;
		box-shadow: none;
	}

	.result-copy {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
		padding: 0.8rem 0.9rem 0.9rem;
	}

	.result-copy h3,
	.result-copy p {
		margin: 0;
	}

	.result-copy h3 {
		overflow: hidden;
		font-family: var(--font-heading);
		font-size: 1.08rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-copy p {
		color: var(--muted);
		font-size: 0.78rem;
	}

	.preview :global(.media-viewer) {
		border: 0;
		border-radius: 0;
	}

	.document-result:focus-within {
		border-color: var(--archive);
		box-shadow: 0 0 0 3px rgb(var(--archive-rgb) / 12%);
	}

	@media (hover: hover) and (pointer: fine) {
		.document-result:hover {
			transform: translateY(-2px);
			border-color: var(--line-strong);
			box-shadow: var(--shadow-soft);
		}
	}

	@media (max-width: 620px) {
		.preview,
		.preview-state {
			min-height: 15rem;
		}
	}
</style>
