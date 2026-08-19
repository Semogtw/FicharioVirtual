<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy, untrack } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import LoadingCollection from '$lib/components/LoadingCollection.svelte';
	import SearchDocumentCard from '$lib/components/SearchDocumentCard.svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { appendUniqueDocumentResults } from '$lib/search/unique-document-results';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';
	import {
		searchPagesHybrid,
		type SemanticSearchAnalysis,
		type SemanticSearchResult
	} from '$lib/services/semantic-search';

	const pageSize = 18;
	const requests = new RequestVersion();
	const notebookRequests = new RequestVersion();
	let query = $state('');
	let notebookId = $state('');
	let results = $state<readonly SemanticSearchResult[]>([]);
	let nextOffset = $state(0);
	let analysis = $state<SemanticSearchAnalysis | null>(null);
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookLoading = $state(false);
	let notebookError = $state<string | null>(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let hasMore = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;
	let notebookLoadTimer: ReturnType<typeof setTimeout> | null = null;
	let notebookLoadStarted = false;

	function cancelPending() {
		if (timer) clearTimeout(timer);
		timer = null;
		controller?.abort();
		controller = null;
	}

	function resetSearchState() {
		results = [];
		nextOffset = 0;
		analysis = null;
		hasMore = false;
	}

	function syncQueryToUrl() {
		if (typeof window === 'undefined') return;
		const nextUrl = new URL(page.url);
		const normalized = query.trim();
		if (normalized) nextUrl.searchParams.set('q', normalized);
		else nextUrl.searchParams.delete('q');
		if (nextUrl.search === page.url.search) return;
		replaceState(nextUrl, page.state);
	}

	async function run(reset: boolean, version = reset ? requests.next() : requests.current()) {
		if (!reset && loadingMore) return;
		const normalized = query.trim();
		if (!normalized) {
			requests.next();
			cancelPending();
			resetSearchState();
			error = null;
			loading = false;
			loadingMore = false;
			return;
		}
		if (!requests.isCurrent(version)) return;
		controller?.abort();
		const activeController = new AbortController();
		controller = activeController;
		const requestOffset = reset ? 0 : nextOffset;
		if (reset) loading = true;
		else loadingMore = true;
		error = null;

		try {
			const response = await searchPagesHybrid(normalized, {
				notebookId: notebookId || null,
				limit: pageSize,
				offset: requestOffset,
				signal: activeController.signal
			});
			if (!requests.isCurrent(version)) return;
			results = appendUniqueDocumentResults(reset ? [] : results, response.results);
			nextOffset = requestOffset + response.results.length;
			analysis = response.analysis;
			hasMore = response.hasMore;
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (requests.isCurrent(version)) error = 'Não foi possível concluir esta pesquisa agora.';
		} finally {
			if (requests.isCurrent(version)) {
				if (controller === activeController) controller = null;
				loading = false;
				loadingMore = false;
			}
		}
	}

	function schedule() {
		cancelPending();
		const version = requests.next();
		timer = setTimeout(() => {
			syncQueryToUrl();
			void run(true, version);
		}, 300);
	}

	function ensureNotebookOptions() {
		if (notebookLoadTimer) clearTimeout(notebookLoadTimer);
		notebookLoadTimer = null;
		if (notebookLoadStarted && !notebookError) return;
		notebookLoadStarted = true;
		void loadNotebookOptions();
	}

	function semanticStatus() {
		if (!analysis) return null;
		if (
			analysis.reason === 'semantic_quota_or_rate_limit' ||
			analysis.reason === 'semantic_provider_unavailable' ||
			analysis.reason === 'semantic_function_unavailable' ||
			analysis.reason === 'semantic_rpc_unavailable'
		) {
			return 'A busca por significado está temporariamente indisponível. Os resultados por texto continuam funcionando.';
		}
		return null;
	}

	async function loadNotebookOptions(version = notebookRequests.next()) {
		notebookLoading = true;
		notebookError = null;
		try {
			const items = await listNotebooks();
			if (!notebookRequests.isCurrent(version)) return;
			notebooks = items;
		} catch {
			if (notebookRequests.isCurrent(version)) {
				notebookError = 'Não foi possível carregar os cadernos para o filtro.';
			}
		} finally {
			if (notebookRequests.isCurrent(version)) notebookLoading = false;
		}
	}

	$effect(() => {
		if (typeof window === 'undefined' || notebookLoadStarted) return;
		notebookLoadTimer = setTimeout(() => {
			notebookLoadTimer = null;
			notebookLoadStarted = true;
			void loadNotebookOptions();
		}, 900);
		return () => {
			if (notebookLoadTimer) clearTimeout(notebookLoadTimer);
			notebookLoadTimer = null;
		};
	});

	$effect(() => {
		const routeQuery = page.url.searchParams.get('q')?.slice(0, 200) ?? '';
		if (routeQuery === untrack(() => query)) return;
		query = routeQuery;
		untrack(() => {
			void run(true);
		});
	});

	onDestroy(() => {
		requests.next();
		notebookRequests.next();
		cancelPending();
		if (notebookLoadTimer) clearTimeout(notebookLoadTimer);
	});
</script>

<svelte:head>
	<title>Pesquisar — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Busca</p>
		<h1 id="page-title">Pesquisar no fichário</h1>
		<p>Encontre o documento pela palavra, trecho ou ideia que você lembra.</p>
	</header>

	<section class="search-panel" aria-label="Pesquisar documentos">
		<label class="query-field">
			<span class="visually-hidden">Termos da pesquisa</span>
			<input
				type="search"
				name="q"
				inputmode="search"
				autocomplete="off"
				bind:value={query}
				maxlength="200"
				placeholder="Ex.: conservação de energia, fotossíntese, capítulo 4"
				oninput={schedule}
			/>
		</label>
		<label class="notebook-filter">
			<span class="visually-hidden">Filtrar por caderno</span>
			<NativeSelect
				bind:value={notebookId}
				disabled={notebookLoading}
				onfocus={ensureNotebookOptions}
				onpointerdown={ensureNotebookOptions}
				onchange={() => void run(true)}
			>
				<option value="">Todos os cadernos</option>
				{#each notebooks as notebook}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</NativeSelect>
		</label>
		<Button
			label={loading ? 'Pesquisando…' : 'Pesquisar'}
			disabled={loading || query.trim().length === 0}
			onclick={() => {
				syncQueryToUrl();
				void run(true);
			}}
		/>
	</section>

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

	{#if semanticStatus()}
		<p class="semantic-status" role="status">{semanticStatus()}</p>
	{/if}

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void run(true)} />
		</div>
	{:else if loading}
		<LoadingCollection variant="search" count={6} label="Procurando nos seus documentos…" />
	{:else if query.trim().length === 0}
		<EmptyState
			title="Digite algo para pesquisar"
			description="Você pode procurar uma palavra, um trecho ou uma ideia presente nos seus documentos."
		/>
	{:else if results.length === 0}
		<EmptyState
			title="Nenhum documento encontrado"
			description="Tente reformular a busca, remova filtros ou verifique se o documento já terminou de processar."
		/>
	{:else}
		<section class="results" aria-labelledby="results-title">
			<div class="results-heading">
				<h2 id="results-title">Resultados</h2>
				<span>{results.length}{hasMore ? '+' : ''} documentos</span>
			</div>
			<ol>
				{#each results as result (result.documentId)}
					<li>
						<SearchDocumentCard {result} query={query.trim()} />
					</li>
				{/each}
			</ol>
			{#if hasMore}
				<div class="load-more">
					<Button
						label={loadingMore ? 'Carregando…' : 'Carregar mais'}
						variant="secondary"
						disabled={loadingMore}
						onclick={() => void run(false)}
					/>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.page,
	.results {
		display: grid;
		gap: 1.35rem;
	}

	.eyebrow {
		margin-bottom: 0.45rem;
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 520;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header > p:last-child {
		max-width: 52rem;
		margin-bottom: 0;
		color: var(--muted);
		line-height: 1.6;
	}

	.search-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(12rem, 0.3fr) auto;
		gap: 0.7rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	input[type='search'] {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.semantic-status {
		margin: 0;
		padding: 0.65rem 0.8rem;
		border-left: 0.22rem solid var(--accent);
		background: rgb(var(--accent-rgb) / 7%);
		color: var(--muted);
		font-size: 0.83rem;
	}

	.results-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}

	.results-heading h2 {
		margin-bottom: 0;
		font-size: 2rem;
	}

	.results-heading span {
		color: var(--muted);
		font-size: 0.82rem;
	}

	ol {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
		align-items: start;
		gap: 0.9rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		min-width: 0;
	}

	.filter-warning,
	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(var(--danger-rgb) / 7%);
	}

	.filter-warning {
		border-left-color: var(--accent);
		background: rgb(var(--accent-rgb) / 7%);
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
	}

	@media (max-width: 760px) {
		.search-panel {
			grid-template-columns: 1fr;
		}
	}
</style>
