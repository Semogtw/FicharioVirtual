<script lang="ts">
	import { onDestroy } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import {
		MAX_UNIT_TOPICS,
		parseUnitTopics,
		type TopicCoverageStatus,
		type UnitCoverageSummary
	} from '$lib/coverage/topic-coverage';
	import { highlightSnippet } from '$lib/search/highlight';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';
	import { analyzeUnitCoverage } from '$lib/services/topic-coverage';

	const notebookRequests = new RequestVersion();
	const coverageRequests = new RequestVersion();
	let unitName = $state('');
	let topicInput = $state('');
	let notebookId = $state('');
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookLoading = $state(true);
	let notebookError = $state<string | null>(null);
	let summary = $state<UnitCoverageSummary | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let controller: AbortController | null = null;

	let topicPreview = $derived.by(() => {
		try {
			return { topics: parseUnitTopics(topicInput), error: null as string | null };
		} catch (caught) {
			return {
				topics: Object.freeze([]) as readonly string[],
				error: caught instanceof Error ? caught.message : 'A lista de assuntos não é válida.'
			};
		}
	});

	const statusLabel: Record<TopicCoverageStatus, string> = {
		covered: 'Coberto',
		partial: 'Parcial',
		missing: 'Não encontrado'
	};

	async function loadNotebookOptions(version = notebookRequests.next()) {
		notebookLoading = true;
		notebookError = null;
		try {
			const items = await listNotebooks();
			if (notebookRequests.isCurrent(version)) notebooks = items;
		} catch {
			if (notebookRequests.isCurrent(version)) {
				notebookError = 'Não foi possível carregar os cadernos para o filtro.';
			}
		} finally {
			if (notebookRequests.isCurrent(version)) notebookLoading = false;
		}
	}

	async function analyze() {
		if (topicPreview.error) {
			error = topicPreview.error;
			return;
		}
		if (topicPreview.topics.length === 0) {
			error = 'Adicione pelo menos um assunto para analisar.';
			return;
		}

		const version = coverageRequests.next();
		controller?.abort();
		const activeController = new AbortController();
		controller = activeController;
		loading = true;
		error = null;
		try {
			const result = await analyzeUnitCoverage(topicPreview.topics, {
				notebookId: notebookId || null,
				signal: activeController.signal
			});
			if (coverageRequests.isCurrent(version)) summary = result;
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (coverageRequests.isCurrent(version)) {
				error =
					caught instanceof Error && caught instanceof TypeError
						? caught.message
						: 'Não foi possível analisar a cobertura desta unidade agora.';
			}
		} finally {
			if (coverageRequests.isCurrent(version)) {
				loading = false;
				if (controller === activeController) controller = null;
			}
		}
	}

	$effect(() => {
		void loadNotebookOptions();
	});

	onDestroy(() => {
		notebookRequests.next();
		coverageRequests.next();
		controller?.abort();
	});
</script>

<svelte:head>
	<title>Cobertura da unidade — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Cobertura de conteúdo</p>
		<h1 id="page-title">O que do conteúdo já está no seu fichário?</h1>
		<p>
			Cole os assuntos de uma unidade. O Fichário compara cada item com o texto nativo, OCR e
			correções já pesquisáveis, sem depender de IA generativa.
		</p>
	</header>

	<section class="setup" aria-labelledby="setup-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Unidade</p>
				<h2 id="setup-title">Assuntos para verificar</h2>
			</div>
			<span>{topicPreview.topics.length}/{MAX_UNIT_TOPICS} assuntos</span>
		</div>

		<div class="fields">
			<label>
				<span>Nome da unidade <small>(opcional)</small></span>
				<input bind:value={unitName} maxlength="120" placeholder="Ex.: Unidade III — Termodinâmica" />
			</label>
			<label>
				<span>Buscar em</span>
				<NativeSelect bind:value={notebookId} disabled={notebookLoading}>
					<option value="">Todo o fichário</option>
					{#each notebooks as notebook}
						<option value={notebook.id}>{notebook.name}</option>
					{/each}
				</NativeSelect>
			</label>
		</div>

		<label class="topics-field">
			<span>Lista de assuntos</span>
			<textarea
				bind:value={topicInput}
				rows="9"
				placeholder={'3.1 Temperatura\n3.2 Calor específico\n3.3 Mudanças de fase\n3.4 Primeira lei da termodinâmica'}
			></textarea>
			<small>Uma linha por assunto. Numeração e marcadores são removidos automaticamente.</small>
		</label>

		{#if topicPreview.error}
			<p class="validation" role="alert">{topicPreview.error}</p>
		{/if}
		{#if notebookError}
			<div class="warning" role="status">
				<p>{notebookError}</p>
				<Button label="Tentar novamente" variant="secondary" onclick={() => void loadNotebookOptions()} />
			</div>
		{/if}

		<div class="actions">
			<Button
				label={loading ? 'Analisando…' : 'Verificar cobertura'}
				disabled={loading || topicPreview.topics.length === 0 || Boolean(topicPreview.error)}
				onclick={() => void analyze()}
			/>
			<p>Até quatro pesquisas são executadas em paralelo para evitar rajadas desnecessárias.</p>
		</div>
	</section>

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void analyze()} />
		</div>
	{/if}

	{#if loading}
		<p class="loading" role="status">Comparando os assuntos com as páginas pesquisáveis…</p>
	{:else if summary}
		<section class="coverage" aria-labelledby="coverage-title">
			<div class="coverage-summary">
				<div>
					<p class="eyebrow">Resultado</p>
					<h2 id="coverage-title">{unitName.trim() || 'Cobertura da unidade'}</h2>
				</div>
				<strong aria-label={`${summary.percentage}% de cobertura`}>{summary.percentage}%</strong>
			</div>

			<div class="progress" aria-hidden="true">
				<span style={`width: ${summary.percentage}%`}></span>
			</div>

			<div class="counts" aria-label="Resumo por situação">
				<span><b>{summary.counts.covered}</b> cobertos</span>
				<span><b>{summary.counts.partial}</b> parciais</span>
				<span><b>{summary.counts.missing}</b> não encontrados</span>
			</div>

			<ol class="topic-results">
				{#each summary.topics as topic}
					<li class={`topic-card ${topic.status}`}>
						<div class="topic-heading">
							<div>
								<span class="status">{statusLabel[topic.status]}</span>
								<h3>{topic.topic}</h3>
							</div>
							<span class="strength">indício {topic.strength}%</span>
						</div>

						{#if topic.evidence.length === 0}
							<p class="no-evidence">
								Nenhuma página pesquisável trouxe um indício suficiente para este assunto.
							</p>
						{:else}
							<ul class="evidence" aria-label={`Evidências para ${topic.topic}`}>
								{#each topic.evidence as evidence}
									<li>
										<a
											href={`/documents/${evidence.documentId}/?page=${evidence.pageNumber}&highlight=${encodeURIComponent(topic.topic)}`}
										>
											<div class="evidence-meta">
												<strong>{evidence.documentTitle}</strong>
												<span>Página {evidence.pageNumber}</span>
												{#if evidence.notebookName}<span>{evidence.notebookName}</span>{/if}
											</div>
											<p>
												{#each highlightSnippet(evidence.excerpt, topic.topic) as part}
													{#if part.highlighted}<mark>{part.text}</mark>{:else}{part.text}{/if}
												{/each}
											</p>
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ol>

			<p class="method-note">
				A classificação usa a força da busca textual/fuzzy atual. “Parcial” indica que há indícios,
				mas não evidência forte o bastante para afirmar cobertura completa. Busca semântica pode ser
				adicionada depois como refinamento, sem mudar este contrato de interface.
			</p>
		</section>
	{/if}
</div>

<style>
	.page,
	.setup,
	.coverage,
	.topic-results,
	.evidence {
		display: grid;
		gap: 1.25rem;
	}

	header > p:last-child {
		max-width: 52rem;
		color: var(--muted);
		line-height: 1.65;
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
	h2,
	h3 {
		font-family: var(--font-heading);
		font-weight: 520;
	}

	h1 {
		max-width: 58rem;
		margin-bottom: 0.65rem;
		font-size: clamp(2.4rem, 6vw, 4.7rem);
		line-height: 1;
		letter-spacing: -0.04em;
	}

	h2,
	h3,
	p {
		margin-top: 0;
	}

	.setup,
	.coverage {
		padding: clamp(1rem, 3vw, 1.6rem);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.section-heading,
	.coverage-summary,
	.topic-heading,
	.evidence-meta,
	.actions,
	.warning,
	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.section-heading h2,
	.coverage-summary h2,
	.topic-heading h3 {
		margin-bottom: 0;
	}

	.section-heading > span,
	.strength,
	.actions p,
	.topics-field small {
		color: var(--muted);
		font-size: 0.8rem;
	}

	.fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(13rem, 0.38fr);
		gap: 0.85rem;
	}

	label {
		display: grid;
		gap: 0.45rem;
		font-weight: 700;
	}

	label > span small {
		color: var(--muted);
		font-weight: 500;
	}

	input,
	textarea {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font: inherit;
	}

	textarea {
		min-height: 13rem;
		resize: vertical;
		line-height: 1.55;
	}

	.validation,
	.warning p,
	.error p {
		margin: 0;
		color: var(--danger);
	}

	.warning,
	.error {
		padding: 1rem;
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
	}

	.error {
		border-left-color: var(--danger);
		background: rgb(155 63 54 / 7%);
	}

	.actions {
		justify-content: flex-start;
	}

	.actions p {
		margin: 0;
	}

	.loading {
		padding: 2.5rem;
		color: var(--muted);
		text-align: center;
	}

	.coverage-summary strong {
		color: var(--archive);
		font-family: var(--font-heading);
		font-size: clamp(2.6rem, 6vw, 4.6rem);
		font-weight: 620;
	}

	.progress {
		height: 0.7rem;
		overflow: hidden;
		border-radius: 999px;
		background: var(--archive-soft);
	}

	.progress span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--archive);
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.counts span,
	.status,
	.strength {
		padding: 0.35rem 0.55rem;
		border-radius: 999px;
		background: var(--paper);
	}

	.topic-results,
	.evidence {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.topic-card {
		display: grid;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-left-width: 0.3rem;
		border-radius: var(--radius-md);
		background: var(--surface-strong);
	}

	.topic-card.covered {
		border-left-color: var(--archive);
	}

	.topic-card.partial {
		border-left-color: var(--accent);
	}

	.topic-card.missing {
		border-left-color: var(--danger);
	}

	.status {
		display: inline-block;
		margin-bottom: 0.35rem;
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.evidence {
		gap: 0.55rem;
	}

	.evidence li {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.evidence a {
		display: grid;
		gap: 0.55rem;
		padding: 0.8rem;
	}

	.evidence-meta {
		justify-content: flex-start;
		flex-wrap: wrap;
	}

	.evidence-meta span {
		color: var(--muted);
		font-size: 0.76rem;
	}

	.evidence p,
	.no-evidence,
	.method-note {
		margin: 0;
		color: var(--muted);
		line-height: 1.6;
	}

	mark {
		padding-inline: 0.08em;
		background: rgb(236 190 76 / 38%);
		color: inherit;
	}

	.method-note {
		padding-top: 1rem;
		border-top: 1px solid var(--line);
		font-size: 0.84rem;
	}

	@media (max-width: 760px) {
		.fields {
			grid-template-columns: 1fr;
		}

		.section-heading,
		.coverage-summary,
		.topic-heading,
		.actions,
		.warning,
		.error {
			align-items: flex-start;
			flex-direction: column;
		}

		.coverage-summary strong {
			font-size: 3rem;
		}
	}
</style>
