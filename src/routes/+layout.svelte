<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import '$lib/design/global.css';

	let { children } = $props();

	const isPublicRoute = $derived(
		page.url.pathname === '/' ||
			page.url.pathname.startsWith('/login') ||
			page.url.pathname.startsWith('/privacy') ||
			page.url.pathname.startsWith('/terms')
	);
</script>

{#if isPublicRoute}
	{@render children()}
{:else}
	<AppShell>
		{@render children()}
	</AppShell>
{/if}
