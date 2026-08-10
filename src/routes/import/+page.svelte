<script lang="ts">
	import UnifiedImportPage from '$lib/components/UnifiedImportPage.svelte';
</script>

<svelte:head>
	<title>Importar — Fichário Virtual</title>
</svelte:head>

<UnifiedImportPage />

<style>
	:global(.file-button),
	:global(.camera-button) {
		position: relative;
	}

	:global(.file-button:focus-within),
	:global(.camera-button:focus-within) {
		outline: 0.1875rem solid var(--focus);
		outline-offset: 0.1875rem;
	}
</style>
