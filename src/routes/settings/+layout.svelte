<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<nav class="settings-tabs" aria-label="Seções das configurações">
	<a href="/settings/" aria-current={page.url.pathname === '/settings/' ? 'page' : undefined}>
		Geral
	</a>
	<a
		href="/settings/computers/"
		aria-current={page.url.pathname.startsWith('/settings/computers') ? 'page' : undefined}
	>
		Computadores
	</a>
	<a
		href="/settings/usage/"
		aria-current={page.url.pathname.startsWith('/settings/usage') ? 'page' : undefined}
	>
		Uso
	</a>
</nav>

{@render children()}

<style>
	.settings-tabs {
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

	@media (max-width: 520px) {
		.settings-tabs {
			width: 100%;
			overflow-x: auto;
		}

		a {
			flex: 1 0 auto;
			justify-content: center;
		}
	}
</style>
