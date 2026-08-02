<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import DocumentCard from '$lib/components/DocumentCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { DocumentSummary } from '$lib/domain/document';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { listDocuments } from '$lib/services/documents';
	import { listNotebooks } from '$lib/services/notebooks';

	let notebook = $state<NotebookSummary | null>(null);
	let documents = $state<readonly DocumentSummary[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function initialize() {
		loading = true;
		error = null;
		try {
			const [notebooks, documentPage] = await Promise.all([
				listNotebooks(),
				listDocuments({ filters: { notebookId: page.params.id }, limit: 60 })
			]);
			notebook = notebooks.find((item) => item.id === page.params.id) ?? null;
			documents = documentPage.items;
			if (!notebook) error = 'Este caderno não existe ou não está disponível.';
		} catch {
			error = 'Não foi possível abrir este caderno agora.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void initialize();
	});
</script>

<svelte:head>
	<title>{notebook?.name ?? 'Caderno'} — Fichário Virtual</title>
</svelte:head>

<div class="page">
	<a class="back" href="/notebooks/">← Todos os cadernos</a>

	{#if loading}
		<p class="loading" role="status">Abrindo o caderno…</p>
	{:else if error}
		<div class="error" role="alert">{error}</div>
	{:else if notebook}
		<header>
			<div>
				<p class="eyebrow">Caderno</p>
				<h1>{notebook.name}</h1>
				<p>{notebook.description ?? 'Documentos reunidos neste caderno.'}</p>
			</div>
			<a class="primary-action" href={`/import/?notebook=${notebook.id}`}>Adicionar documento</a>
		</header>

		{#if documents.length === 0}
			<EmptyState
				title="Este caderno está vazio"
				description="Adicione um documento existente ou importe um novo arquivo diretamente para este caderno."
			/>
		{:else}
			<section class="grid" aria-label={`Documentos em ${notebook.name}`}>
				{#each documents as document (document.id)}
					<DocumentCard {document} />
				{/each}
			</section>
		{/if}
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1.5rem;
	}

	.back {
		width: fit-content;
		color: var(--archive);
		font-size: 0.86rem;
		font-weight: 720;
	}

	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--line);
	}

	.eyebrow {
		margin-bottom: 0.45rem;
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-family: var(--font-heading);
		font-size: clamp(2.5rem, 7vw, 5rem);
		font-weight: 520;
		letter-spacing: -0.045em;
	}

	header p:last-child {
		margin-bottom: 0;
		color: var(--muted);
	}

	.primary-action {
		min-height: 2.8rem;
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
		padding: 0.7rem 1rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 740;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
	}

	.loading {
		padding: 3rem;
		color: var(--muted);
		text-align: center;
	}

	.error {
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
	}

	@media (max-width: 560px) {
		header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
