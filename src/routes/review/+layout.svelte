<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<nav class="review-tabs" aria-label="Seções da revisão">
	<a href="/review/" aria-current={page.url.pathname === '/review/' ? 'page' : undefined}>
		Fila remota
	</a>
	<a
		href="/review/drafts/"
		aria-current={page.url.pathname.startsWith('/review/drafts') ? 'page' : undefined}
	>
		Rascunhos locais
	</a>
</nav>

{@render children()}

<style>
	.review-tabs {
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
		min-height: 2.45rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.85rem;
		border-radius: calc(var(--radius-md) - 0.2rem);
		color: var(--muted);
		font-size: 0.84rem;
		font-weight: 740;
	}

	a[aria-current='page'] {
		background: var(--archive);
		color: white;
	}
</style>
