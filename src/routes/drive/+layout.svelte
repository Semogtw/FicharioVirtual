<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<nav class="drive-tabs" aria-label="Ferramentas do Google Drive">
	<a href="/drive/">Recuperação</a>
	<a href="/import/drive/">Importar do Drive</a>
</nav>

{@render children()}

<style>
	.drive-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
		padding: 0.45rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	a {
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.8rem;
		border-radius: var(--radius-sm);
		color: var(--muted);
		font-size: 0.88rem;
		font-weight: 720;
	}

	a:hover,
	a:focus-visible {
		background: var(--archive-soft);
		color: var(--archive);
	}
</style>
