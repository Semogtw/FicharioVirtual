<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import DocumentCard from '$lib/components/DocumentCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type {
		DocumentCursor,
		DocumentKind,
		DocumentStatus,
		DocumentSummary
	} from '$lib/domain/document';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { listDocuments } from '$lib/services/documents';
	import { listNotebooks } from '$lib/services/notebooks';

	let documents = $state<DocumentSummary[]>([]);
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let nextCursor = $state<DocumentCursor | null>(null);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let notebookId = $state('');
	let kind = $state<DocumentKind | ''>('');
	let status = $state<DocumentStatus | ''>('');
	let createdFrom = $state('');
	let createdTo = $state('');

	function dateStart(value: string) {
		return value ? `${value}T00:00:00.000Z` : null;
	}

	function dateEnd(value: string) {
		return value ? `${value}T23:59:59.999Z` : null;
	}

	async function load(reset: boolean) {
		if (reset) loading = true;
		else loadingMore = true;
		error = null;
		try {
			const page = await listDocuments({
				filters: {
					notebookId: notebookId || null,
					kind: kind || null,
					status: status || null,
					createdFrom: dateStart(createdFrom),
					createdTo: dateEnd(createdTo)
				},
				cursor: reset ? null : nextCursor
			});
			documents = reset ? [...page.items] : [...documents, ...page.items];
			nextCursor = page.nextCursor;
		} catch {
			error = 'Não foi possível carregar a biblioteca agora.';
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	async function initialize() {
		const notebooksPromise = listNotebooks().catch(() => [] as const);
		await load(true);
		notebooks = await notebooksPromise;
	}

	onMount(() => {
		void initialize();
	});
</script>

<svelte:head>
	<title>Biblioteca — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header class="page-header">
		<div>
			<p class="eyebrow">Arquivo pesquisável</p>
			<h1 id="page-title">Biblioteca</h1>
			<p>Consulte os originais, acompanhe o processamento e organize tudo por caderno.</p>
		</div>
		<a class="primary-action" href="/import/">Importar</a>
	</header>

	<form class="filters" aria-label="Filtrar biblioteca" onsubmit={(event) => event.preventDefault()}>
		<label>
			<span>Caderno</span>
			<select bind:value={notebookId} onchange={() => void load(true)}>
				<option value="">Todos</option>
				{#each notebooks as notebook}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>Tipo</span>
			<select bind:value={kind} onchange={() => void load(true)}>
				<option value="">Todos</option>
				<option value="image">Imagem</option>
				<option value="pdf">PDF</option>
			</select>
		</label>
		<label>
			<span>Estado</span>
			<select bind:value={status} onchange={() => void load(true)}>
				<option value="">Todos</option>
				<option value="ready">Pronto</option>
				<option value="processing">Processando</option>
				<option value="needs_review">Revisar</option>
				<option value="failed">Falhou</option>
			</select>
		</label>
		<label>
			<span>De</span>
			<input type="date" bind:value={createdFrom} onchange={() => void load(true)} />
		</label>
		<label>
			<span>Até</span>
			<input type="date" bind:value={createdTo} onchange={() => void load(true)} />
		</label>
	</form>

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void load(true)} />
		</div>
	{:else if loading}
		<p class="loading" role="status">Organizando seus documentos…</p>
	{:else if documents.length === 0}
		<EmptyState
			title="Nenhum documento neste recorte"
			description="Ajuste os filtros ou importe um novo arquivo para começar sua biblioteca."
			actionLabel="Importar documento"
			onAction={() => (window.location.href = '/import/')}
		/>
	{:else}
		<section class="grid" aria-label="Documentos">
			{#each documents as document (document.id)}
				<DocumentCard {document} />
			{/each}
		</section>

		{#if nextCursor}
			<div class="load-more">
				<Button
					label={loadingMore ? 'Carregando…' : 'Carregar mais'}
					variant="secondary"
					disabled={loadingMore}
					onclick={() => void load(false)}
				/>
			</div>
		{/if}
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1.5rem;
	}

	.page-header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.5rem;
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
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		font-weight: 520;
		letter-spacing: -0.04em;
	}

	.page-header p:last-child {
		margin-bottom: 0;
		color: var(--muted);
	}

	.primary-action {
		min-height: 2.8rem;
		display: inline-flex;
		align-items: center;
		padding: 0.7rem 1rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 740;
	}

	.filters {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	label {
		display: grid;
		gap: 0.35rem;
	}

	label span {
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 740;
	}

	select,
	input {
		width: 100%;
		min-height: 2.7rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
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
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
	}

	.error p {
		margin: 0;
		color: var(--danger);
	}

	.load-more {
		display: flex;
		justify-content: center;
		padding-top: 0.5rem;
	}

	@media (max-width: 900px) {
		.filters {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		.page-header {
			align-items: flex-start;
			flex-direction: column;
		}

		.filters {
			grid-template-columns: 1fr;
		}
	}
</style>
