<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import DocumentCard from '$lib/components/DocumentCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import LoadingCollection from '$lib/components/LoadingCollection.svelte';
	import type {
		DocumentCursor,
		DocumentKind,
		DocumentStatus,
		DocumentSummary
	} from '$lib/domain/document';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { localDateEndIso, localDateStartIso } from '$lib/services/date-filter';
	import { listDocuments } from '$lib/services/documents';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';

	const requests = new RequestVersion();
	const notebookRequests = new RequestVersion();
	let documents = $state<DocumentSummary[]>([]);
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let nextCursor = $state<DocumentCursor | null>(null);
	let loading = $state(true);
	let loadingMore = $state(false);
	let notebookLoading = $state(true);
	let error = $state<string | null>(null);
	let notebookError = $state<string | null>(null);
	let notebookId = $state('');
	let kind = $state<DocumentKind | ''>('');
	let status = $state<DocumentStatus | ''>('');
	let createdFrom = $state('');
	let createdTo = $state('');
	let hasActiveFilters = $derived(
		Boolean(notebookId || kind || status || createdFrom || createdTo)
	);
	let dateRangeError = $derived(
		createdFrom && createdTo && createdFrom > createdTo
			? 'A data inicial precisa ser anterior ou igual à data final.'
			: null
	);

	function clearFilters() {
		notebookId = '';
		kind = '';
		status = '';
		createdFrom = '';
		createdTo = '';
		void load(true);
	}

	async function load(reset: boolean) {
		if (!reset && loadingMore) return;
		if (dateRangeError) {
			requests.next();
			loading = false;
			loadingMore = false;
			error = null;
			return;
		}
		const requestVersion = reset ? requests.next() : requests.current();
		if (reset) loading = true;
		else loadingMore = true;
		error = null;
		try {
			const page = await listDocuments({
				filters: {
					notebookId: notebookId || null,
					kind: kind || null,
					status: status || null,
					createdFrom: localDateStartIso(createdFrom),
					createdTo: localDateEndIso(createdTo)
				},
				cursor: reset ? null : nextCursor
			});
			if (!requests.isCurrent(requestVersion)) return;
			documents = reset ? [...page.items] : [...documents, ...page.items];
			nextCursor = page.nextCursor;
		} catch {
			if (requests.isCurrent(requestVersion)) {
				error = 'Não foi possível carregar a biblioteca agora.';
			}
		} finally {
			if (requests.isCurrent(requestVersion)) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	async function loadNotebookOptions(version = notebookRequests.next()) {
		notebookLoading = true;
		notebookError = null;
		try {
			const loadedNotebooks = await listNotebooks();
			if (!notebookRequests.isCurrent(version)) return;
			notebooks = loadedNotebooks;
		} catch {
			if (notebookRequests.isCurrent(version)) {
				notebookError = 'Não foi possível carregar os cadernos para o filtro.';
			}
		} finally {
			if (notebookRequests.isCurrent(version)) notebookLoading = false;
		}
	}

	async function initialize() {
		void loadNotebookOptions();
		await load(true);
	}

	onMount(() => {
		void initialize();
	});

	onDestroy(() => {
		requests.next();
		notebookRequests.next();
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
			<p>Consulte seus documentos e organize tudo por caderno.</p>
		</div>
		<a class="primary-action" href="/import/">Importar</a>
	</header>

	<form class="filters" aria-label="Filtrar biblioteca" onsubmit={(event) => event.preventDefault()}>
		<label>
			<span>Caderno</span>
			<NativeSelect
				ariaLabel="Caderno"
				bind:value={notebookId}
				disabled={notebookLoading}
				onchange={() => void load(true)}
			>
				<option value="">Todos</option>
				{#each notebooks as notebook}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</NativeSelect>
		</label>
		<label>
			<span>Tipo</span>
			<NativeSelect ariaLabel="Tipo" bind:value={kind} onchange={() => void load(true)}>
				<option value="">Todos</option>
				<option value="image">Imagem</option>
				<option value="pdf">PDF</option>
			</NativeSelect>
		</label>
		<label>
			<span>Status</span>
			<NativeSelect ariaLabel="Status" bind:value={status} onchange={() => void load(true)}>
				<option value="">Todos</option>
				<option value="ready">Pronto</option>
				<option value="processing">Processando</option>
				<option value="needs_review">Revisar</option>
				<option value="failed">Falhou</option>
			</NativeSelect>
		</label>
		<label>
			<span>De</span>
			<input
				type="date"
				aria-label="De"
				aria-invalid={dateRangeError ? 'true' : undefined}
				bind:value={createdFrom}
				onchange={() => void load(true)}
			/>
		</label>
		<label>
			<span>Até</span>
			<input
				type="date"
				aria-label="Até"
				aria-invalid={dateRangeError ? 'true' : undefined}
				bind:value={createdTo}
				onchange={() => void load(true)}
			/>
		</label>
		{#if dateRangeError}
			<p class="filter-validation" role="alert">{dateRangeError}</p>
		{/if}
		{#if hasActiveFilters}
			<div class="filter-actions">
				<span>Filtros ativos</span>
				<Button label="Limpar filtros" variant="quiet" onclick={clearFilters} />
			</div>
		{/if}
	</form>

	{#if notebookError}
		<div class="filter-warning" role="status">
			<p>{notebookError}</p>
			<Button
				label="Tentar carregar cadernos"
				variant="secondary"
				onclick={() => void loadNotebookOptions()}
			/>
		</div>
	{/if}

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void load(true)} />
		</div>
	{:else if loading}
		<LoadingCollection label="Organizando seus documentos…" />
	{:else if documents.length === 0}
		<EmptyState
			title={hasActiveFilters ? 'Nenhum documento com esses filtros' : 'Sua biblioteca ainda está vazia'}
			description={hasActiveFilters
				? 'Limpe ou ajuste os filtros para voltar a ver outros documentos.'
				: 'Importe uma imagem ou PDF para começar sua biblioteca.'}
			actionLabel={hasActiveFilters ? 'Limpar filtros' : 'Importar documento'}
			onAction={hasActiveFilters ? clearFilters : () => (window.location.href = '/import/')}
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

	input {
		width: 100%;
		min-height: 2.7rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
	}

	input[aria-invalid='true'] {
		border-color: var(--danger);
	}

	.filter-validation {
		grid-column: 1 / -1;
		margin: 0;
		color: var(--danger);
		font-size: 0.78rem;
	}

	.filter-actions {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 0.15rem;
		border-top: 1px solid var(--line);
		color: var(--muted);
		font-size: 0.78rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
	}

	.grid :global(.document-card) {
		content-visibility: auto;
		contain-intrinsic-size: auto 20rem;
	}

	.filter-warning,
	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
	}

	.filter-warning {
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
	}

	.filter-warning p,
	.error p {
		margin: 0;
	}

	.filter-warning p {
		color: var(--accent-strong);
	}

	.error p {
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
