<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<nav class="library-tabs" aria-label="Seções da biblioteca">
	<a href="/library/" aria-current={page.url.pathname === '/library/' ? 'page' : undefined}>
		Documentos
	</a>
	<a
		href="/library/tags/"
		aria-current={page.url.pathname.startsWith('/library/tags') ? 'page' : undefined}
	>
		Tags
	</a>
	<a
		href="/library/organize/"
		aria-current={page.url.pathname.startsWith('/library/organize') ? 'page' : undefined}
	>
		Organizar
	</a>
</nav>

{@render children()}

<style>
	.library-tabs {
		display: flex;
		gap: 0.35rem;
		width: fit-content;
		max-width: 100%;
		overflow-x: auto;
		margin-bottom: 1.25rem;
		padding: 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
		scrollbar-width: none;
	}

	.library-tabs::-webkit-scrollbar {
		display: none;
	}

	a {
		min-height: 2.45rem;
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
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
