<script lang="ts">
	import { goto } from '$app/navigation';
	import EmptyState from '$lib/components/EmptyState.svelte';

	function startImport() {
		void goto('/import/');
	}
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
				Imagens, PDFs e anotações organizados como um fichário — pesquisáveis sem perder o
				original.
			</p>
		</div>
		<a class="primary-action" href="/import/">Importar documento</a>
	</header>

	<section class="overview" aria-label="Resumo da biblioteca">
		<article>
			<span>Documentos</span>
			<strong>0</strong>
			<small>A biblioteca está pronta para começar</small>
		</article>
		<article>
			<span>Páginas pesquisáveis</span>
			<strong>0</strong>
			<small>Texto nativo e leituras revisadas</small>
		</article>
		<article>
			<span>Para revisar</span>
			<strong>0</strong>
			<small>Nenhum trecho aguardando atenção</small>
		</article>
	</section>

	<section class="recent" aria-labelledby="recent-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Biblioteca</p>
				<h2 id="recent-title">Documentos recentes</h2>
			</div>
			<a href="/library/">Ver biblioteca</a>
		</div>

		<EmptyState
			title="Seu fichário ainda está vazio"
			description="Importe uma imagem ou PDF. O arquivo original será preservado enquanto o texto é preparado para pesquisa."
			actionLabel="Importar o primeiro documento"
			onAction={startImport}
		/>
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

	.section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}

	h2 {
		margin-bottom: 0;
		font-size: clamp(1.75rem, 4vw, 2.6rem);
	}

	.section-heading > a {
		color: var(--archive);
		font-weight: 720;
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
