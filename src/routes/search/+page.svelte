<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy, untrack } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { highlightSnippet } from '$lib/search/highlight';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';
	import { searchPages, type SearchResult } from '$lib/services/search';

	const pageSize = 30;
	const requests = new RequestVersion();
	const notebookRequests = new RequestVersion();
	let query = $state('');
	let notebookId = $state('');
	let results = $state<readonly SearchResult[]>([]);
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookLoading = $state(true);
	let notebookError = $state<string | null>(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let hasMore = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;

	function cancelPending() {
		if (timer) clearTimeout(timer);
		timer = null;
		controller?.abort();
		controller = null;
	}

	async function run(reset: boolean, version = reset ? requests.next() : requests.current()) {
		if (!reset && loadingMore) return;
		const normalized = query.trim();
		if (!normalized) {
			requests.next();
			cancelPending();
			results = [];
			hasMore = false;
			error = null;
			loading = false;
			loadingMore = false;
			return;
		}
		if (!requests.isCurrent(version)) return;
		controller?.abort();
		const activeController = new AbortController();
		controller = activeController;
		if (reset) loading = true;
		else loadingMore = true;
		error = null;
		try {
			const pageResults = await searchPages(normalized, {
				notebookId: notebookId || null,
				limit: pageSize,
				offset: reset ? 0 : results.length,
				signal: activeController.signal
			});
			if (!requests.isCurrent(version)) return;
			results = reset ? pageResults : Object.freeze([...results, ...pageResults]);
			hasMore = pageResults.length === pageSize;
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
		timer = setTimeout(() => void run(true, version), 220);
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
		void loadNotebookOptions();
	});

	$effect(() => {
		const routeQuery = page.url.searchParams.get('q')?.slice(0, 200) ?? '';
		query = routeQuery;
		untrack(() => {
			void run(true);
		});
	});

	onDestroy(() => {
		requests.next();
		notebookRequests.next();
		cancelPending();
	});
</script>

<svelte:head>
	<title>Pesquisar — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Busca textual</p>
		<h1 id="page-title">Pesquisar no fichário</h1>
		<p>
			Encontre palavras aproximadas, títulos e conteúdo corrigido sem enviar a consulta a outro
			serviço.
		</p>
	</header>

	<section class="search-panel" aria-label="Pesquisar páginas">
		<label class="query-field">
			<span class="visually-hidden">Termos da pesquisa</span>
			<input
				type="search"
				bind:value={query}
				maxlength="200"
				placeholder="Ex.: fotossíntese, mitose, capítulo 4"
				oninput={schedule}
			/>
		</label>
		<label class="notebook-filter">
			<span class="visually-hidden">Filtrar por caderno</span>
			<NativeSelect
				bind:value={notebookId}
				disabled={notebookLoading}
				onchange={() => void run(true)}
			>
				<option value="">Todos os cadernos</option>
				{#each notebooks as notebook}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</NativeSelect>
		</label>
		<Button label="Pesquisar" onclick={() => void run(true)} />
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

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void run(true)} />
		</div>
	{:else if loading}
		<p class="loading" role="status">Pesquisando suas páginas…</p>
	{:else if query.trim().length === 0}
		<EmptyState
			title="Digite algo para pesquisar"
			description="A busca considera texto nativo de PDFs, transcrições e correções manuais."
		/>
	{:else if results.length === 0}
		<EmptyState
			title="Nenhuma página encontrada"
			description="Tente uma palavra menor, remova filtros ou verifique se o documento já terminou de processar."
		/>
	{:else}
		<section class="results" aria-labelledby="results-title">
			<div class="results-heading">
				<h2 id="results-title">Resultados</h2>
				<span>{results.length}{hasMore ? '+' : ''} páginas</span>
			</div>
			<ol>
				{#each results as result (result.pageId)}
					<li>
						<a
							href={`/documents/${result.documentId}/?page=${result.pageNumber}&highlight=${encodeURIComponent(query.trim())}`}
						>
							<div class="result-meta">
								<strong>{result.documentTitle}</strong>
								<span>Página {result.pageNumber}</span>
								{#if result.notebookName}<span>{result.notebookName}</span>{/if}
							</div>
							<p>
								{#each highlightSnippet(result.excerpt, query) as part}
									{#if part.highlighted}<mark>{part.text}</mark>{:else}{part.text}{/if}
								{/each}
							</p>
						</a>
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
		max-width: 46rem;
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

	input {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
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
		gap: 0.65rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	li:focus-within {
		border-color: var(--line-strong);
		box-shadow: var(--shadow-soft);
	}

	li a {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;
	}

	.result-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.45rem 0.8rem;
	}

	.result-meta strong {
		font-family: var(--font-heading);
		font-size: 1.2rem;
		font-weight: 560;
	}

	.result-meta span {
		color: var(--muted);
		font-size: 0.78rem;
	}

	li p {
		margin: 0;
		color: #454b48;
		line-height: 1.65;
	}

	mark {
		padding-inline: 0.08em;
		background: rgb(236 190 76 / 38%);
		color: inherit;
	}

	.loading {
		padding: 3rem;
		color: var(--muted);
		text-align: center;
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
		border-left-color: var(--accent);
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
	}

	@media (hover: hover) and (pointer: fine) {
		li:hover {
			border-color: var(--line-strong);
			box-shadow: var(--shadow-soft);
		}
	}

	@media (max-width: 760px) {
		.search-panel {
			grid-template-columns: 1fr;
		}
	}
</style>
