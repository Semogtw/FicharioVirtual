<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import '$lib/design/global.css';

	let { children } = $props();
</script>

{#if page.url.pathname.startsWith('/login')}
	{@render children()}
{:else}
	<AppShell>
		{@render children()}
	</AppShell>
{/if}
