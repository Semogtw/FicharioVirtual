<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import DocumentCard from '$lib/components/DocumentCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { DocumentSummary } from '$lib/domain/document';
	import { listDocuments } from '$lib/services/documents';
	import { RequestVersion } from '$lib/services/request-version';
	import { loadUsageOverview } from '$lib/services/usage';
	import type { UsageOverview } from '$lib/services/usage';

	const dashboardRequests = new RequestVersion();
	let usage = $state<UsageOverview | null>(null);
	let recentDocuments = $state<readonly DocumentSummary[]>([]);
	let documentsAvailable = $state(false);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let warning = $state<string | null>(null);

	function startImport() {
		void goto('/import/');
	}

	async function loadDashboard(version = dashboardRequests.next()) {
		loading = true;
		error = null;
		warning = null;
		try {
			const [usageResult, documentsResult] = await Promise.allSettled([
				loadUsageOverview(),
				listDocuments({ limit: 6 })
			]);
			if (!dashboardRequests.isCurrent(version)) return;

			if (usageResult.status === 'fulfilled') usage = usageResult.value;
			else usage = null;

			if (documentsResult.status === 'fulfilled') {
				recentDocuments = documentsResult.value.items;
				documentsAvailable = true;
			} else {
				recentDocuments = [];
				documentsAvailable = false;
			}

			if (usageResult.status === 'rejected' && documentsResult.status === 'rejected') {
				error = 'Não foi possível carregar o resumo do fichário agora.';
			} else if (usageResult.status === 'rejected' || documentsResult.status === 'rejected') {
				warning = 'Parte do resumo não pôde ser atualizada.';
			}
		} catch {
			if (dashboardRequests.isCurrent(version)) {
				error = 'Não foi possível carregar o resumo do fichário agora.';
			}
		} finally {
			if (dashboardRequests.isCurrent(version)) loading = false;
		}
	}

	onMount(() => {
		void loadDashboard();
	});

	onDestroy(() => {
		dashboardRequests.next();
	});
</script>

<svelte:head>
	<title>Início — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header class="page-header">
		<div>
			<p class="eyebrow">Seu arquivo pessoal</p>
			<h1 id="page-title">Encontre a página certa.</h1>
			<p class="summary">
				Imagens, PDFs e anotações organizados como um fichário — pesquisáveis sem perder o original.
			</p>
		</div>
		<a class="primary-action" href="/import/">Importar documento</a>
	</header>

	<section class="overview" aria-label="Resumo da biblioteca" aria-busy={loading}>
		<article>
			<span>Documentos</span>
			<strong>{usage ? usage.totals.documents.toLocaleString('pt-BR') : '—'}</strong>
			<small>Arquivos privados preservados no fichário</small>
		</article>
		<article>
			<span>Páginas no fichário</span>
			<strong>{usage ? usage.totals.pages.toLocaleString('pt-BR') : '—'}</strong>
			<small>Texto nativo, leituras e correções manuais</small>
		</article>
		<article>
			<span>Para revisar</span>
			<strong>{usage ? usage.totals.reviewPages.toLocaleString('pt-BR') : '—'}</strong>
			<small>Páginas que ainda pedem atenção humana</small>
		</article>
	</section>

	{#if warning}<p class="warning" role="status">{warning}</p>{/if}

	<section class="recent" aria-labelledby="recent-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Biblioteca</p>
				<h2 id="recent-title">Documentos recentes</h2>
			</div>
			<a href="/library/">Ver biblioteca</a>
		</div>

		{#if loading}
			<p class="loading" role="status">Atualizando o resumo do fichário…</p>
		{:else if error}
			<div class="error" role="alert">
				<p>{error}</p>
				<button type="button" onclick={() => void loadDashboard()}>Tentar novamente</button>
			</div>
		{:else if !documentsAvailable}
			<div class="error" role="alert">
				<p>Os documentos recentes não puderam ser carregados.</p>
				<button type="button" onclick={() => void loadDashboard()}>Tentar novamente</button>
			</div>
		{:else if recentDocuments.length === 0}
			<EmptyState
				title="Seu fichário ainda está vazio"
				description="Importe uma imagem ou PDF. O arquivo original será preservado enquanto o texto é preparado para pesquisa."
				actionLabel="Importar o primeiro documento"
				onAction={startImport}
			/>
		{:else}
			<div class="recent-grid" aria-label="Documentos adicionados recentemente">
				{#each recentDocuments as document (document.id)}
					<DocumentCard {document} />
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: clamp(2rem, 4vw, 3.5rem);
	}

	.page-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 2rem;
		padding: clamp(1rem, 3vw, 2rem) 0 0;
	}

	.eyebrow {
		margin-bottom: 0.55rem;
		color: var(--archive);
		font-size: 0.76rem;
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
		max-width: 48rem;
		margin-bottom: 0.8rem;
		font-size: clamp(2.6rem, 7vw, 5.75rem);
		line-height: 0.98;
		letter-spacing: -0.045em;
	}

	.summary {
		max-width: 42rem;
		margin-bottom: 0;
		color: var(--muted);
		font-size: clamp(1rem, 2vw, 1.2rem);
		line-height: 1.65;
	}

	.primary-action {
		min-height: 2.9rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		padding: 0.75rem 1.05rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 740;
	}

	.overview {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}

	.overview article {
		display: grid;
		gap: 0.35rem;
		min-height: 10.5rem;
		align-content: space-between;
		padding: 1.25rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.overview span,
	.overview small {
		color: var(--muted);
	}

	.overview span {
		font-size: 0.82rem;
		font-weight: 720;
		letter-spacing: 0.03em;
	}

	.overview strong {
		font-family: var(--font-heading);
		font-size: 3rem;
		font-weight: 520;
		line-height: 1;
	}

	.overview small {
		line-height: 1.45;
	}

	.recent {
		display: grid;
		gap: 1.25rem;
	}

	.section-heading,
	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.section-heading {
		align-items: end;
	}

	h2 {
		margin-bottom: 0;
		font-size: clamp(1.75rem, 4vw, 2.6rem);
	}

	.section-heading > a {
		color: var(--archive);
		font-weight: 720;
	}

	.recent-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
	}

	.loading {
		padding: 3rem;
		color: var(--muted);
		text-align: center;
	}

	.warning {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
		color: var(--accent-strong);
	}

	.error {
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
	}

	.error p {
		margin: 0;
	}

	.error button {
		min-height: 2.45rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-weight: 720;
		cursor: pointer;
	}

	@media (max-width: 760px) {
		.page-header {
			align-items: flex-start;
			flex-direction: column;
		}

		.overview {
			grid-template-columns: 1fr;
		}

		.overview article {
			min-height: 8rem;
		}
	}
</style>
