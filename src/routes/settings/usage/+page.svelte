<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { loadUsageOverview, type UsageOverview } from '$lib/services/usage';

	let overview = $state<UsageOverview | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let maximumDaily = $derived(
		overview ? Math.max(1, ...overview.daily.map((day) => day.ocrPages)) : 1
	);

	async function refresh() {
		loading = true;
		error = null;
		try {
			overview = await loadUsageOverview();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível carregar o uso.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void refresh();
	});
</script>

<svelte:head>
	<title>Uso — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Operação local e gratuita</p>
		<h1 id="page-title">Uso</h1>
		<p>
			Contadores técnicos do seu próprio arquivo. Nenhum texto, imagem ou consulta aparece aqui.
		</p>
	</header>

	{#if loading}
		<p class="loading" role="status">Calculando os contadores…</p>
	{:else if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void refresh()} />
		</div>
	{:else if overview}
		<section class="metrics" aria-label="Resumo do arquivo">
			<article>
				<span>Cadernos</span>
				<strong>{overview.totals.notebooks}</strong>
			</article>
			<article>
				<span>Documentos</span>
				<strong>{overview.totals.documents}</strong>
			</article>
			<article>
				<span>Páginas</span>
				<strong>{overview.totals.pages}</strong>
			</article>
			<article class:attention={overview.totals.pendingPages > 0}>
				<span>Pendentes</span>
				<strong>{overview.totals.pendingPages}</strong>
			</article>
			<article class:attention={overview.totals.reviewPages > 0}>
				<span>Para revisão</span>
				<strong>{overview.totals.reviewPages}</strong>
			</article>
			<article class:danger={overview.totals.failedPages > 0}>
				<span>Falhas</span>
				<strong>{overview.totals.failedPages}</strong>
			</article>
		</section>

		<section class="today" aria-labelledby="today-title">
			<div>
				<p class="eyebrow">Hoje · {overview.today.date}</p>
				<h2 id="today-title">Leitura automática</h2>
				<p>
					{overview.today.ocrPages}
					{overview.today.ocrPages === 1 ? 'página processada' : 'páginas processadas'}
					{#if overview.today.quotaErrors > 0}
						· {overview.today.quotaErrors}
						{overview.today.quotaErrors === 1 ? 'bloqueio de cota' : 'bloqueios de cota'}
					{/if}
				</p>
			</div>
			<a href="/review/">Abrir pendências</a>
		</section>

		<section class="history" aria-labelledby="history-title">
			<div class="section-heading">
				<div>
					<p class="eyebrow">Últimos 30 dias</p>
					<h2 id="history-title">Páginas enviadas ao OCR</h2>
				</div>
				<span>{overview.totals.manualReviews} correções manuais acumuladas</span>
			</div>

			{#if overview.daily.length === 0}
				<p class="empty-history">Nenhum uso OCR registrado neste período.</p>
			{:else}
				<div class="chart" role="img" aria-label="Histórico diário de páginas processadas">
					{#each overview.daily as day}
						<div class="bar-column" title={`${day.date}: ${day.ocrPages} páginas`}>
							<span class="value">{day.ocrPages}</span>
							<div
								class="bar"
								class:quota={day.quotaErrors > 0}
								style={`--height: ${Math.max(0.08, day.ocrPages / maximumDaily) * 100}%`}
							></div>
							<small>{day.date.slice(5)}</small>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<p class="generated">Atualizado em {new Date(overview.generatedAt).toLocaleString('pt-BR')}.</p>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
	}

	.eyebrow {
		margin-bottom: 0.4rem;
		color: var(--archive);
		font-size: 0.73rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 540;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header > p:last-child {
		max-width: 48rem;
		margin-bottom: 0.5rem;
		color: var(--muted);
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.65rem;
	}

	.metrics article {
		display: grid;
		gap: 0.3rem;
		padding: 0.85rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.metrics article.attention {
		border-color: rgb(166 94 67 / 40%);
	}

	.metrics article.danger {
		border-color: rgb(155 63 54 / 40%);
	}

	.metrics span {
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.metrics strong {
		font-family: var(--font-heading);
		font-size: 2rem;
		font-weight: 540;
	}

	.today,
	.history {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.today {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}

	.today h2,
	.history h2 {
		margin-bottom: 0.35rem;
		font-size: 1.5rem;
	}

	.today p:last-child {
		margin: 0;
		color: var(--muted);
	}

	.today a {
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.8rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-size: 0.8rem;
		font-weight: 720;
	}

	.section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.section-heading > span,
	.generated {
		color: var(--muted);
		font-size: 0.76rem;
	}

	.chart {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(2rem, 1fr));
		align-items: end;
		gap: 0.35rem;
		min-height: 13rem;
		padding-top: 1rem;
		overflow-x: auto;
	}

	.bar-column {
		min-width: 2rem;
		height: 12rem;
		display: grid;
		grid-template-rows: 1.2rem minmax(0, 1fr) 1rem;
		align-items: end;
		justify-items: center;
		gap: 0.25rem;
	}

	.value {
		color: var(--muted);
		font-size: 0.65rem;
	}

	.bar {
		width: min(1.35rem, 80%);
		height: var(--height);
		min-height: 0.3rem;
		border-radius: 0.35rem 0.35rem 0.1rem 0.1rem;
		background: var(--archive);
	}

	.bar.quota {
		background: var(--accent);
	}

	.bar-column small {
		color: var(--muted);
		font-size: 0.58rem;
		writing-mode: vertical-rl;
	}

	.empty-history,
	.loading {
		padding: 2.5rem;
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

	.generated {
		margin: 0;
		text-align: right;
	}

	@media (max-width: 980px) {
		.metrics {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 580px) {
		.metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.today,
		.section-heading {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
