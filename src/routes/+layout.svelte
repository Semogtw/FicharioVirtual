<script lang="ts">
	import AppShell from '$lib/components/AppShell.svelte';
	import '$lib/design/global.css';

	let { children } = $props();
</script>

<AppShell>
	{@render children()}
</AppShell>
