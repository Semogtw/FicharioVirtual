<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';

	interface QueuePanelMotionProps {
		children: Snippet;
	}

	let { children }: QueuePanelMotionProps = $props();
</script>

<div transition:fly={{ y: -8, duration: 220 }}>
	{@render children()}
</div>
