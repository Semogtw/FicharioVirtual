<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<nav class="drive-navigation" aria-label="Google Drive">
	<div class="drive-sections">
		<a href="/drive/" aria-current={page.url.pathname === '/drive/' ? 'page' : undefined}>
			Visão geral
		</a>
		<a
			href="/drive/jobs/"
			aria-current={page.url.pathname.startsWith('/drive/jobs') ? 'page' : undefined}
		>
			Pendências
		</a>
		<a
			href="/drive/conflicts/"
			aria-current={page.url.pathname.startsWith('/drive/conflicts') ? 'page' : undefined}
		>
			Conflitos
		</a>
	</div>
	<a class="import-link" href="/import/drive/">Importar do Drive</a>
</nav>

{@render children()}

<style>
	.drive-navigation {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.drive-sections {
		display: flex;
		gap: 0.35rem;
		min-width: 0;
		overflow-x: auto;
		padding: 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
		scrollbar-width: none;
	}

	.drive-sections::-webkit-scrollbar {
		display: none;
	}

	.drive-sections a,
	.import-link {
		min-height: 2.45rem;
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
		padding: 0.55rem 0.85rem;
		border-radius: calc(var(--radius-md) - 0.2rem);
		font-size: 0.84rem;
		font-weight: 740;
	}

	.drive-sections a {
		color: var(--muted);
	}

	.drive-sections a[aria-current='page'] {
		background: var(--archive);
		color: white;
	}

	.import-link {
		border: 1px solid var(--line-strong);
		background: var(--surface-strong);
		color: var(--archive);
		white-space: nowrap;
	}

	@media (max-width: 680px) {
		.drive-navigation {
			align-items: stretch;
			flex-direction: column;
		}

		.drive-sections {
			width: 100%;
		}

		.import-link {
			justify-content: center;
			width: 100%;
		}
	}
</style>
