<script lang="ts">
	import { page } from '$app/state';
	import { importHref, parseRequestedNotebookId } from '$lib/import/notebook-selection';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
	let requestedNotebookId = $derived(parseRequestedNotebookId(page.url.searchParams));
	let imageHref = $derived(importHref('/import/', requestedNotebookId));
	let pdfHref = $derived(importHref('/import/pdf/', requestedNotebookId));
</script>

<nav class="import-tabs" aria-label="Tipo de importação">
	<a href={imageHref} aria-current={page.url.pathname === '/import/' ? 'page' : undefined}>
		Imagens
	</a>
	<a href={pdfHref} aria-current={page.url.pathname.startsWith('/import/pdf') ? 'page' : undefined}>
		PDFs
	</a>
</nav>

{@render children()}

<style>
	.import-tabs {
		display: flex;
		gap: 0.35rem;
		width: fit-content;
		margin-bottom: 1.25rem;
		padding: 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	a {
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.9rem;
		border-radius: calc(var(--radius-md) - 0.2rem);
		color: var(--muted);
		font-size: 0.86rem;
		font-weight: 740;
	}

	a[aria-current='page'] {
		background: var(--archive);
		color: white;
		box-shadow: 0 0.2rem 0.8rem rgb(32 33 36 / 10%);
	}
</style>
