<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { processPageOcr } from '$lib/services/ocr';
	import { RequestVersion } from '$lib/services/request-version';
	import { listReviewItems, type ReviewItem } from '$lib/services/review';

	const pageSize = 50;
	const loadRequests = new RequestVersion();
	let items = $state<readonly ReviewItem[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let hasMore = $state(false);
	let error = $state<string | null>(null);
	let processingPageId = $state<string | null>(null);

	const statusLabels = {
		needs_review: 'Revisão humana',
		retryable: 'Pode tentar novamente',
		blocked_quota: 'Aguardando nova cota',
		failed: 'Falha permanente'
	} as const;

	async function load(
		reset: boolean,
		version = reset ? loadRequests.next() : loadRequests.current()
	) {
		if (!reset && loadingMore) return;
		const offset = reset ? 0 : items.length;
		if (reset) {
			loading = true;
			loadingMore = false;
		} else {
			loadingMore = true;
		}
		error = null;
		try {
			const page = await listReviewItems({ limit: pageSize, offset });
			if (!loadRequests.isCurrent(version)) return;
			items = reset ? page : Object.freeze([...items, ...page]);
			hasMore = page.length === pageSize;
		} catch {
			if (loadRequests.isCurrent(version)) {
				error = 'Não foi possível carregar a fila de revisão.';
			}
		} finally {
			if (loadRequests.isCurrent(version)) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	async function retry(item: ReviewItem) {
		if (processingPageId) return;
		processingPageId = item.pageId;
		error = null;
		try {
			await processPageOcr(item.pageId);
			await load(true);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'A página ainda não pôde ser retomada.';
		} finally {
			processingPageId = null;
		}
	}

	onMount(() => {
		void load(true);
	});

	onDestroy(() => {
		loadRequests.next();
	});
</script>

<svelte:head>
	<title>Revisar — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Qualidade e continuidade</p>
		<h1 id="page-title">Fila de revisão</h1>
		<p>
			Corrija trechos incertos e retome páginas interrompidas sem reenviar os arquivos originais.
		</p>
	</header>

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void load(true)} />
		</div>
	{/if}

	{#if loading}
		<p class="loading" role="status">Organizando páginas que precisam de atenção…</p>
	{:else if items.length === 0}
		<EmptyState
			title="Nenhuma página pendente"
			description="Quando o OCR sinalizar dúvida, quota ou falha, a página aparecerá aqui."
		/>
	{:else}
		<section class="list" aria-label="Páginas para revisar">
			{#each items as item (item.pageId)}
				<article>
					<div class={`kind ${item.documentKind}`} aria-hidden="true">
						{item.documentKind === 'pdf' ? 'PDF' : 'IMG'}
					</div>
					<div class="copy">
						<div class="meta">
							<strong>{item.documentTitle}</strong>
							<span>Página {item.pageNumber}</span>
							<span class={`status ${item.pageStatus}`}>
								{statusLabels[item.pageStatus as keyof typeof statusLabels] ?? item.pageStatus}
							</span>
						</div>
						<p>{item.excerpt || 'Nenhum texto disponível ainda.'}</p>
						{#if item.warnings.length > 0}
							<ul>
								{#each item.warnings as warning}<li>{warning.message}</li>{/each}
							</ul>
						{/if}
					</div>
					<div class="actions">
						{#if ['retryable', 'blocked_quota'].includes(item.pageStatus)}
							<button
								type="button"
								disabled={processingPageId !== null}
								onclick={() => void retry(item)}
							>
								{processingPageId === item.pageId ? 'Retomando…' : 'Retomar leitura'}
							</button>
						{/if}
						<a href={`/documents/${item.documentId}/?page=${item.pageNumber}`}>
							{item.pageStatus === 'needs_review' ? 'Corrigir' : 'Abrir página'}
						</a>
					</div>
				</article>
			{/each}
		</section>

		{#if hasMore}
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
	.page,
	.list {
		display: grid;
		gap: 1rem;
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

	header p:last-child {
		max-width: 48rem;
		margin-bottom: 0;
		color: var(--muted);
		line-height: 1.6;
	}

	article {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr) auto;
		align-items: start;
		gap: 0.9rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.kind {
		width: 3.5rem;
		height: 4rem;
		display: grid;
		place-items: center;
		border-radius: 0.3rem;
		background: var(--accent);
		color: white;
		font-size: 0.68rem;
		font-weight: 820;
		letter-spacing: 0.08em;
	}

	.kind.image {
		background: var(--archive);
	}

	.copy {
		min-width: 0;
		display: grid;
		gap: 0.55rem;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem 0.7rem;
	}

	.meta strong {
		font-family: var(--font-heading);
		font-size: 1.18rem;
		font-weight: 560;
	}

	.meta > span {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.status {
		padding: 0.22rem 0.42rem;
		border-radius: 99rem;
		background: var(--paper);
		font-weight: 720;
	}

	.status.needs_review,
	.status.blocked_quota {
		color: var(--accent-strong);
	}

	.status.failed {
		color: var(--danger);
	}

	.copy > p {
		display: -webkit-box;
		overflow: hidden;
		margin: 0;
		color: #4b514e;
		line-height: 1.55;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
	}

	ul {
		margin: 0;
		padding-left: 1.1rem;
		color: var(--accent-strong);
		font-size: 0.78rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.45rem;
	}

	.actions button,
	.actions a {
		min-height: 2.45rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 720;
		cursor: pointer;
	}

	.actions a {
		border-color: var(--archive);
		background: var(--archive);
		color: white;
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
	}

	@media (max-width: 760px) {
		article {
			grid-template-columns: 3.5rem minmax(0, 1fr);
		}

		.actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
	}
</style>
