<script lang="ts">
	import { page } from '$app/state';
	import { isNativeRuntime } from '$lib/platform/native-bridge';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
	const native = isNativeRuntime();
</script>

<nav class="settings-tabs" aria-label="Seções das configurações">
	<a href="/settings/" aria-current={page.url.pathname === '/settings/' ? 'page' : undefined}>Geral</a>
	{#if native}
		<a href="/settings/storage/" aria-current={page.url.pathname.startsWith('/settings/storage') ? 'page' : undefined}>Armazenamento</a>
	{/if}
	<a href="/settings/computers/" aria-current={page.url.pathname === '/settings/computers/' ? 'page' : undefined}>Computadores</a>
	<a href="/settings/computers/queue/" aria-current={page.url.pathname.startsWith('/settings/computers/queue') ? 'page' : undefined}>Fila de leitura</a>
	<a href="/settings/usage/" aria-current={page.url.pathname.startsWith('/settings/usage') ? 'page' : undefined}>Uso</a>
</nav>

{@render children()}

<style>
	.settings-tabs { display: flex; gap: .35rem; width: fit-content; margin-bottom: 1.25rem; padding: .3rem; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
	a { min-height: 2.45rem; display: inline-flex; align-items: center; padding: .55rem .85rem; border-radius: calc(var(--radius-md) - .2rem); color: var(--muted); font-size: .84rem; font-weight: 740; }
	a[aria-current='page'] { background: var(--archive); color: white; }
	@media (max-width: 520px) { .settings-tabs { width: 100%; overflow-x: auto; } a { flex: 1 0 auto; justify-content: center; } }
</style>
