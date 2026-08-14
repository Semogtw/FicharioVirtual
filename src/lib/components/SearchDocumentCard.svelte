<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import DocumentMediaViewer from '$lib/components/DocumentMediaViewer.svelte';
	import type { PageDetail } from '$lib/domain/page';
	import { countDocumentQueryOccurrences } from '$lib/search/document-search-results';
	import { loadDocumentDetail, type DocumentDetail } from '$lib/services/document-detail';
	import type { SemanticSearchResult } from '$lib/services/semantic-search';

	interface SearchDocumentCardProps {
		result: SemanticSearchResult;
		query: string;
	}

	const EMPTY_PREVIEW_PAGES = Object.freeze([]) as readonly PageDetail[];

	let { result, query }: SearchDocumentCardProps = $props();
	let host = $state<HTMLElement | null>(null);
	let detail = $state<DocumentDetail | null>(null);
	let failed = $state(false);
	let generation = 0;

	let previewPage = $derived(
		detail?.pages.find((page) => page.pageNumber === result.pageNumber) ?? detail?.pages[0] ?? null
	);
	let previewPages = $derived(
		previewPage ? (Object.freeze([previewPage]) as readonly PageDetail[]) : EMPTY_PREVIEW_PAGES
	);
	let previewQuery = $derived(result.matchMode === 'visual' ? '' : query);
	let occurrenceCount = $derived(detail ? countDocumentQueryOccurrences(detail.pages, query) : 0);
	let href = $derived(
		result.matchMode === 'visual'
			? `/documents/${result.documentId}/?page=${result.pageNumber}`
			: `/documents/${result.documentId}/?page=${result.pageNumber}&highlight=${encodeURIComponent(query.trim())}`
	);
	let occurrenceLabel = $derived(
		occurrenceCount === 1 ? '1 ocorrência' : `${occurrenceCount} ocorrências`
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
			const loaded = await loadDocumentDetail(result.documentId);
			if (expectedGeneration !== generation) return;
			detail = loaded;
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
			{ rootMargin: '700px 0px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	});

	onDestroy(() => {
		generation += 1;
	});
</script>

<article class="document-result" bind:this={host}>
	<a
		{href}
		aria-label={`Abrir ${result.documentTitle}, correspondência na página ${result.pageNumber}`}
	>
		<div class="preview">
			{#if detail && previewPage}
				<DocumentMediaViewer {detail} pages={previewPages} query={previewQuery} />
			{:else if failed}
				<div class="preview-state error" role="status">Não foi possível carregar a prévia.</div>
			{:else}
				<div class="preview-state" role="status">Carregando documento…</div>
			{/if}

			<div class="badges" role="group" aria-label="Detalhes da correspondência">
				{#if detail && occurrenceCount > 0}
					<span class="occurrences">{occurrenceLabel}</span>
				{:else if matchLabel}
					<span>{matchLabel}</span>
				{:else if detail}
					<span>Correspondência aproximada</span>
				{/if}
				<span>Página {result.pageNumber}</span>
			</div>
		</div>
		{#if result.notebookName}
			<span class="notebook">{result.notebookName}</span>
		{/if}
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
		margin: 0.65rem;
		box-shadow: none;
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
