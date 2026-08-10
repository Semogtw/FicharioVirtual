<script lang="ts">
	import { onDestroy } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import type { AnalyzedUnitCoverageSummary } from '$lib/coverage/semantic-coverage';
	import type { OcrTopicCandidate, TopicImportConfidence } from '$lib/coverage/topic-import';
	import {
		MAX_TOPIC_LENGTH,
		MAX_UNIT_TOPICS,
		normalizeTopic,
		parseUnitTopics,
		type TopicCoverageStatus
	} from '$lib/coverage/topic-coverage';
	import { highlightSnippet } from '$lib/search/highlight';
	import {
		extractTopicsFromPhoto,
		type CoveragePhotoImportStage
	} from '$lib/services/coverage-photo-import';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';
	import { recordSemanticCoverageConsent } from '$lib/services/semantic-coverage';
	import { analyzeUnitCoverage } from '$lib/services/topic-coverage';

	type EditableTopic = {
		id: string;
		text: string;
		source: 'manual' | 'ocr';
		confidence: TopicImportConfidence;
		reviewRequired: boolean;
		level: number;
	};

	const notebookRequests = new RequestVersion();
	const coverageRequests = new RequestVersion();
	const bulkPlaceholder =
		'3.1 Temperatura\n3.2 Calor específico\n3.3 Mudanças de fase\n3.4 Primeira lei da termodinâmica';
	const confidenceLabel: Record<TopicImportConfidence, string> = {
		high: 'alta',
		medium: 'média',
		low: 'baixa'
	};
	const photoStageLabel: Record<CoveragePhotoImportStage, string> = {
		preparing: 'Preparando a foto…',
		uploading: 'Enviando temporariamente…',
		reading: 'Lendo com OCR…',
		extracting: 'Separando os conteúdos…',
		cleaning_up: 'Removendo o arquivo temporário…'
	};

	let unitName = $state('');
	let bulkInput = $state('');
	let bulkError = $state<string | null>(null);
	let topics = $state<EditableTopic[]>([]);
	let notebookId = $state('');
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookLoading = $state(true);
	let notebookError = $state<string | null>(null);
	let summary = $state<AnalyzedUnitCoverageSummary | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let controller: AbortController | null = null;
	let photoConsent = $state(false);
	let photoImporting = $state(false);
	let photoStage = $state<CoveragePhotoImportStage | null>(null);
	let photoError = $state<string | null>(null);
	let photoNotice = $state<string | null>(null);
	let photoController: AbortController | null = null;
	let semanticEnabled = $state(false);
	let semanticConsentRecorded = $state(false);
	let semanticNotice = $state<string | null>(null);

	let topicValidation = $derived.by(() => {
		try {
			const active = topics.map((topic) => topic.text.trim()).filter(Boolean);
			return {
				topics: parseUnitTopics(active.join('\n')),
				error: null as string | null,
				nonEmptyCount: active.length
			};
		} catch (caught) {
			return {
				topics: Object.freeze([]) as readonly string[],
				error: caught instanceof Error ? caught.message : 'A lista de assuntos não é válida.',
				nonEmptyCount: topics.filter((topic) => topic.text.trim()).length
			};
		}
	});

	let duplicateCount = $derived(
		Math.max(0, topicValidation.nonEmptyCount - topicValidation.topics.length)
	);

	const statusLabel: Record<TopicCoverageStatus, string> = {
		covered: 'Coberto',
		partial: 'Parcial',
		missing: 'Não encontrado'
	};

	function topicId() {
		return (
			globalThis.crypto?.randomUUID?.() ??
			`topic_${Date.now()}_${Math.random().toString(36).slice(2)}`
		);
	}

	function invalidateCoverage() {
		coverageRequests.next();
		controller?.abort();
		controller = null;
		loading = false;
		error = null;
		summary = null;
	}

	function toggleSemantic() {
		semanticNotice = null;
		invalidateCoverage();
	}

	function semanticResultNotice(result: AnalyzedUnitCoverageSummary) {
		const analysis = result.analysis;
		if (!analysis) return null;
		if (analysis.mode === 'lexical') {
			return 'A camada semântica não ficou disponível nesta análise. O resultado textual/fuzzy foi preservado normalmente.';
		}
		const notes = ['Análise híbrida ativa: busca textual/fuzzy + relação semântica.'];
		if (analysis.index) {
			if (analysis.index.complete) {
				notes.push(`Índice semântico atualizado para ${analysis.index.totalPages} página(s).`);
			} else {
				notes.push(
					`Índice semântico em construção: ${analysis.index.indexedPages}/${analysis.index.totalPages} página(s) atuais. A busca textual continua cobrindo o fichário inteiro.`
				);
			}
			if (analysis.index.indexedThisRun > 0) {
				notes.push(`${analysis.index.indexedThisRun} página(s) foram indexadas nesta análise.`);
			}
		}
		if (analysis.verification === 'used') {
			notes.push('Os melhores trechos também foram verificados semanticamente pelo Gemini.');
		} else if (analysis.verification === 'unavailable') {
			notes.push('O verificador Gemini não respondeu; o score híbrido permaneceu disponível.');
		}
		return notes.join(' ');
	}

	function appendEditableTopics(incoming: readonly EditableTopic[]) {
		const seen = new Set(
			topics.map((topic) => normalizeTopic(topic.text)).filter((value) => value.length > 0)
		);
		const accepted: EditableTopic[] = [];
		let duplicates = 0;
		let truncated = false;

		for (const topic of incoming) {
			const normalized = normalizeTopic(topic.text);
			if (!normalized) continue;
			if (seen.has(normalized)) {
				duplicates += 1;
				continue;
			}
			if (topics.length + accepted.length >= MAX_UNIT_TOPICS) {
				truncated = true;
				break;
			}
			seen.add(normalized);
			accepted.push(topic);
		}

		if (accepted.length > 0) {
			topics = [...topics, ...accepted];
			invalidateCoverage();
		}
		return { added: accepted.length, duplicates, truncated };
	}

	function manualTopic(text: string): EditableTopic {
		return {
			id: topicId(),
			text,
			source: 'manual',
			confidence: 'high',
			reviewRequired: false,
			level: 0
		};
	}

	function ocrTopic(candidate: OcrTopicCandidate): EditableTopic {
		return {
			id: topicId(),
			text: candidate.text,
			source: 'ocr',
			confidence: candidate.confidence,
			reviewRequired: candidate.reviewRequired,
			level: candidate.level
		};
	}

	function convertBulkInput() {
		bulkError = null;
		let parsed: readonly string[];
		try {
			parsed = parseUnitTopics(bulkInput);
		} catch (caught) {
			bulkError = caught instanceof Error ? caught.message : 'Não foi possível separar esta lista.';
			return;
		}
		if (parsed.length === 0) {
			bulkError = 'Cole ou escreva pelo menos um assunto.';
			return;
		}
		const result = appendEditableTopics(parsed.map(manualTopic));
		if (result.added > 0) bulkInput = '';
		if (result.truncated) {
			bulkError = `A unidade aceita até ${MAX_UNIT_TOPICS} assuntos. Os itens excedentes não foram adicionados.`;
		} else if (result.duplicates > 0) {
			bulkError = `${result.duplicates} assunto(s) repetido(s) não foram adicionados.`;
		}
	}

	function addBlankTopic() {
		if (topics.length >= MAX_UNIT_TOPICS) {
			bulkError = `A unidade aceita até ${MAX_UNIT_TOPICS} assuntos.`;
			return;
		}
		topics = [...topics, manualTopic('')];
		invalidateCoverage();
	}

	function updateTopic(id: string, event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		topics = topics.map((topic) => (topic.id === id ? { ...topic, text: value } : topic));
		invalidateCoverage();
	}

	function removeTopic(id: string) {
		topics = topics.filter((topic) => topic.id !== id);
		invalidateCoverage();
	}

	function moveTopic(index: number, direction: -1 | 1) {
		const target = index + direction;
		if (target < 0 || target >= topics.length) return;
		const reordered = [...topics];
		const current = reordered[index];
		const other = reordered[target];
		if (!current || !other) return;
		reordered[index] = other;
		reordered[target] = current;
		topics = reordered;
		invalidateCoverage();
	}

	function adjustLevel(id: string, delta: -1 | 1) {
		topics = topics.map((topic) =>
			topic.id === id ? { ...topic, level: Math.min(3, Math.max(0, topic.level + delta)) } : topic
		);
		invalidateCoverage();
	}

	async function importPhoto(file: File) {
		photoError = null;
		photoNotice = null;
		if (!photoConsent) {
			photoError = 'Confirme o aviso de privacidade antes de enviar a foto para leitura.';
			return;
		}
		if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
			photoError = 'Selecione uma foto JPG, PNG ou WebP.';
			return;
		}

		photoController?.abort();
		const activeController = new AbortController();
		photoController = activeController;
		photoImporting = true;
		photoStage = 'preparing';
		try {
			const result = await extractTopicsFromPhoto(file, {
				signal: activeController.signal,
				onStage: (stage) => (photoStage = stage)
			});
			const merged = appendEditableTopics(result.topics.map(ocrTopic));
			const notes = [`${merged.added} conteúdo(s) extraído(s) viraram campos editáveis.`];
			if (merged.duplicates > 0) notes.push(`${merged.duplicates} repetido(s) foram ignorados.`);
			if (merged.truncated || result.truncated) {
				notes.push(`O limite de ${MAX_UNIT_TOPICS} assuntos foi atingido.`);
			}
			if (result.topics.some((topic) => topic.reviewRequired)) {
				notes.push('Os itens com confiança baixa ficaram marcados para revisão.');
			}
			if (result.reusedExistingDocument) {
				notes.push('A foto já existia no fichário e o OCR existente foi reaproveitado.');
			}
			if (result.cleanupWarning) {
				notes.push('A limpeza do arquivo temporário falhou; ele pode aparecer na biblioteca até nova limpeza.');
			}
			photoNotice = notes.join(' ');
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			photoError = caught instanceof Error ? caught.message : 'Não foi possível ler esta foto agora.';
		} finally {
			if (photoController === activeController) {
				photoController = null;
				photoImporting = false;
				photoStage = null;
			}
		}
	}

	function selectPhoto(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) void importPhoto(file);
		input.value = '';
	}

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
		if (topicValidation.error) {
			error = topicValidation.error;
			return;
		}
		if (topicValidation.topics.length === 0) {
			error = 'Adicione pelo menos um assunto para analisar.';
			return;
		}

		const version = coverageRequests.next();
		controller?.abort();
		const activeController = new AbortController();
		controller = activeController;
		loading = true;
		error = null;
		semanticNotice = null;
		try {
			let semanticRequested = semanticEnabled;
			if (semanticRequested && !semanticConsentRecorded) {
				try {
					await recordSemanticCoverageConsent();
					if (!coverageRequests.isCurrent(version)) return;
					semanticConsentRecorded = true;
				} catch {
					semanticRequested = false;
					semanticNotice =
						'Não foi possível registrar o consentimento para enviar trechos ao Gemini. A análise textual/fuzzy será usada desta vez.';
				}
			}

			const result = await analyzeUnitCoverage(topicValidation.topics, {
				notebookId: notebookId || null,
				signal: activeController.signal,
				semantic: semanticRequested
			});
			if (coverageRequests.isCurrent(version)) {
				summary = result;
				semanticNotice = semanticResultNotice(result) ?? semanticNotice;
			}
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
		photoController?.abort();
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
			Monte a ementa digitando, colando uma lista ou fotografando o conteúdo. Antes da análise, cada
			assunto fica em um campo independente para você revisar e corrigir.
		</p>
	</header>

	<section class="setup" aria-labelledby="setup-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Unidade</p>
				<h2 id="setup-title">Assuntos para verificar</h2>
			</div>
			<span>{topicValidation.nonEmptyCount}/{MAX_UNIT_TOPICS} assuntos</span>
		</div>

		<div class="fields">
			<label>
				<span>Nome da unidade <small>(opcional)</small></span>
				<input bind:value={unitName} maxlength="120" placeholder="Ex.: Unidade III — Termodinâmica" />
			</label>
			<label>
				<span>Buscar em</span>
				<NativeSelect bind:value={notebookId} disabled={notebookLoading} onchange={invalidateCoverage}>
					<option value="">Todo o fichário</option>
					{#each notebooks as notebook}
						<option value={notebook.id}>{notebook.name}</option>
					{/each}
				</NativeSelect>
			</label>
		</div>

		<div class="input-methods">
			<section class="input-card" aria-labelledby="manual-input-title">
				<div>
					<p class="eyebrow">Digitar ou colar</p>
					<h3 id="manual-input-title">Lista escrita</h3>
				</div>
				<label class="bulk-field">
					<span>Conteúdos</span>
					<textarea bind:value={bulkInput} rows="6" placeholder={bulkPlaceholder}></textarea>
					<small>Uma linha por assunto. Numeração e marcadores são removidos ao converter.</small>
				</label>
				<div class="compact-actions">
					<Button label="Transformar em campos" variant="secondary" onclick={convertBulkInput} />
					<Button label="Adicionar campo vazio" variant="secondary" onclick={addBlankTopic} />
				</div>
				{#if bulkError}<p class="validation" role="status">{bulkError}</p>{/if}
			</section>

			<section class="input-card photo-card" aria-labelledby="photo-input-title">
				<div>
					<p class="eyebrow">Foto da ementa</p>
					<h3 id="photo-input-title">Extrair com OCR</h3>
					<p>
						O Fichário prepara a imagem, lê o texto e separa a lista em campos individuais. A foto é
						usada temporariamente e removida depois da extração.
					</p>
				</div>
				<label class="consent">
					<input type="checkbox" bind:checked={photoConsent} disabled={photoImporting} />
					<span>
						<strong>Autorizo a leitura automática desta foto.</strong>
						<small>
							No nível gratuito do provedor, o conteúdo pode ser usado para melhorar produtos. A chave
							nunca fica neste navegador e nenhuma cobrança é ativada automaticamente.
						</small>
					</span>
				</label>
				<div class="photo-actions">
					<label class:disabled={!photoConsent || photoImporting} class="file-button">
						Selecionar foto
						<input
							type="file"
							accept="image/jpeg,image/png,image/webp"
							disabled={!photoConsent || photoImporting}
							onchange={selectPhoto}
						/>
					</label>
					<label class:disabled={!photoConsent || photoImporting} class="file-button secondary">
						Usar câmera
						<input
							type="file"
							accept="image/*"
							capture="environment"
							disabled={!photoConsent || photoImporting}
							onchange={selectPhoto}
						/>
					</label>
					{#if photoImporting}
						<button type="button" class="cancel-link" onclick={() => photoController?.abort()}>
							Cancelar
						</button>
					{/if}
				</div>
				{#if photoImporting && photoStage}
					<p class="photo-status" role="status">{photoStageLabel[photoStage]}</p>
				{/if}
				{#if photoError}<p class="validation" role="alert">{photoError}</p>{/if}
				{#if photoNotice}<p class="photo-notice" role="status">{photoNotice}</p>{/if}
			</section>
		</div>

		<section class="topic-editor" aria-labelledby="topic-editor-title">
			<div class="editor-heading">
				<div>
					<p class="eyebrow">Revisão</p>
					<h3 id="topic-editor-title">Conteúdos estruturados</h3>
				</div>
				<Button label="Adicionar assunto" variant="secondary" onclick={addBlankTopic} />
			</div>

			{#if topics.length === 0}
				<p class="empty-editor">
					Os conteúdos aparecerão aqui como campos individuais. Você pode editar, excluir, reordenar e
					ajustar a hierarquia antes de verificar a cobertura.
				</p>
			{:else}
				<ol class="editable-topics">
					{#each topics as topic, index (topic.id)}
						<li class:needs-review={topic.reviewRequired} style={`--topic-level: ${topic.level}`}>
							<div class="topic-index" aria-hidden="true">{index + 1}</div>
							<div class="editable-topic-main">
								<label>
									<span class="sr-only">Conteúdo {index + 1}</span>
									<input
										value={topic.text}
										maxlength={MAX_TOPIC_LENGTH}
										placeholder="Digite o assunto"
										oninput={(event) => updateTopic(topic.id, event)}
									/>
								</label>
								<div class="topic-meta">
									{#if topic.source === 'ocr'}
										<span class={`confidence ${topic.confidence}`}>
											OCR · confiança {confidenceLabel[topic.confidence]}
										</span>
									{:else}
										<span>Manual</span>
									{/if}
									{#if topic.level > 0}<span>nível {topic.level + 1}</span>{/if}
									{#if topic.reviewRequired}<strong>revisar</strong>{/if}
								</div>
							</div>
							<div class="topic-controls" aria-label={`Ações do conteúdo ${index + 1}`}>
								<button
									type="button"
									disabled={topic.level === 0}
									onclick={() => adjustLevel(topic.id, -1)}
									aria-label="Promover nível"
								>←</button>
								<button
									type="button"
									disabled={topic.level === 3}
									onclick={() => adjustLevel(topic.id, 1)}
									aria-label="Rebaixar nível"
								>→</button>
								<button
									type="button"
									disabled={index === 0}
									onclick={() => moveTopic(index, -1)}
									aria-label="Mover para cima"
								>↑</button>
								<button
									type="button"
									disabled={index === topics.length - 1}
									onclick={() => moveTopic(index, 1)}
									aria-label="Mover para baixo"
								>↓</button>
								<button type="button" class="remove" onclick={() => removeTopic(topic.id)}>Excluir</button>
							</div>
						</li>
					{/each}
				</ol>
			{/if}

			{#if topicValidation.error}
				<p class="validation" role="alert">{topicValidation.error}</p>
			{/if}
			{#if duplicateCount > 0}
				<p class="editor-note" role="status">
					{duplicateCount} campo(s) repetido(s) serão considerados uma única vez na análise.
				</p>
			{/if}
			<p class="editor-note">
				A confiança do OCR é um sinal heurístico de revisão, não uma probabilidade estatística. Campos
				marcados como “revisar” devem ser conferidos antes da análise.
			</p>
		</section>

		{#if notebookError}
			<div class="warning" role="status">
				<p>{notebookError}</p>
				<Button label="Tentar novamente" variant="secondary" onclick={() => void loadNotebookOptions()} />
			</div>
		{/if}

		<label class="consent">
			<input
				type="checkbox"
				bind:checked={semanticEnabled}
				disabled={loading}
				onchange={toggleSemantic}
			/>
			<span>
				<strong>Usar relação semântica com Gemini.</strong>
				<small>
					Quando ativado, trechos das suas páginas podem ser enviados ao Gemini para gerar embeddings e
					verificar os melhores candidatos. A busca textual/fuzzy continua sendo o fallback e cobre o
					fichário mesmo sem cota. No nível gratuito do provedor, os dados podem ser usados para melhorar
					produtos.
				</small>
			</span>
		</label>
		{#if semanticNotice}<p class="photo-notice" role="status">{semanticNotice}</p>{/if}

		<div class="actions">
			<Button
				label={loading ? 'Analisando…' : 'Verificar cobertura'}
				disabled={loading || topicValidation.topics.length === 0 || Boolean(topicValidation.error)}
				onclick={() => void analyze()}
			/>
			<p>
				A busca é limitada e concorrente; com semântica ativa, o índice é atualizado em pequenos lotes.
			</p>
		</div>
	</section>

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void analyze()} />
		</div>
	{/if}

	{#if loading}
		<p class="loading" role="status">
			{semanticEnabled
				? 'Comparando os assuntos por texto e significado…'
				: 'Comparando os assuntos com as páginas pesquisáveis…'}
		</p>
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
				{#if summary.analysis?.mode === 'hybrid'}
					A classificação combina busca textual/fuzzy, similaridade por embeddings e, quando disponível,
					verificação conservadora do Gemini sobre poucos trechos candidatos. O percentual continua
					derivado dos mesmos estados Coberto, Parcial e Não encontrado.
				{:else}
					A classificação usa a força da busca textual/fuzzy. “Parcial” indica que há indícios, mas não
					evidência forte o bastante para afirmar cobertura completa.
				{/if}
			</p>
		</section>
	{/if}
</div>

<style>
	.page,
	.setup,
	.coverage,
	.topic-results,
	.evidence,
	.topic-editor,
	.input-card {
		display: grid;
		gap: 1.25rem;
	}

	header > p:last-child {
		max-width: 56rem;
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
	.error,
	.editor-heading,
	.compact-actions,
	.photo-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.section-heading h2,
	.coverage-summary h2,
	.topic-heading h3,
	.editor-heading h3,
	.input-card h3 {
		margin-bottom: 0;
	}

	.section-heading > span,
	.strength,
	.actions p,
	.bulk-field small,
	.editor-note,
	.photo-card > div > p:last-child {
		color: var(--muted);
		font-size: 0.8rem;
	}

	.fields,
	.input-methods {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(13rem, 0.5fr);
		gap: 0.85rem;
	}

	.input-methods {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.input-card,
	.topic-editor {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface-strong);
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
		min-height: 9rem;
		resize: vertical;
		line-height: 1.55;
	}

	.compact-actions,
	.photo-actions,
	.actions {
		justify-content: flex-start;
		flex-wrap: wrap;
	}

	.consent {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		padding: 0.85rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--paper);
	}

	.consent input {
		width: auto;
		margin-top: 0.2rem;
	}

	.consent span {
		display: grid;
		gap: 0.25rem;
	}

	.consent small {
		color: var(--muted);
		font-weight: 500;
		line-height: 1.45;
	}

	.file-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.6rem;
		padding: 0.65rem 0.9rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: var(--surface-strong);
		cursor: pointer;
		font-weight: 750;
	}

	.file-button.secondary {
		border: 1px solid var(--line-strong);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.file-button.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.file-button input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
	}

	.cancel-link,
	.topic-controls button {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		cursor: pointer;
		font: inherit;
	}

	.cancel-link {
		padding: 0.6rem 0.75rem;
	}

	.photo-status,
	.photo-notice,
	.validation,
	.warning p,
	.error p,
	.editor-note {
		margin: 0;
	}

	.photo-status,
	.photo-notice {
		color: var(--muted);
		line-height: 1.55;
	}

	.validation,
	.warning p,
	.error p {
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

	.empty-editor {
		margin: 0;
		padding: 1rem;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-sm);
		color: var(--muted);
		line-height: 1.6;
	}

	.editable-topics {
		display: grid;
		gap: 0.65rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.editable-topics li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.65rem;
		margin-left: calc(var(--topic-level) * 1.25rem);
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--paper);
	}

	.editable-topics li.needs-review {
		border-left: 0.3rem solid var(--accent);
	}

	.topic-index {
		display: grid;
		width: 1.8rem;
		height: 1.8rem;
		place-items: center;
		border-radius: 999px;
		background: var(--archive-soft);
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 800;
	}

	.editable-topic-main {
		display: grid;
		gap: 0.35rem;
	}

	.editable-topic-main input {
		background: var(--surface-strong);
	}

	.topic-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		color: var(--muted);
		font-size: 0.72rem;
	}

	.topic-meta span,
	.topic-meta strong {
		padding: 0.2rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-strong);
	}

	.topic-meta strong {
		color: var(--accent);
		text-transform: uppercase;
	}

	.confidence.high {
		color: var(--archive);
	}

	.confidence.low {
		color: var(--danger);
	}

	.topic-controls {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem;
	}

	.topic-controls button {
		min-width: 2rem;
		padding: 0.45rem 0.55rem;
	}

	.topic-controls button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.topic-controls .remove {
		color: var(--danger);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
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

	@media (max-width: 900px) {
		.input-methods {
			grid-template-columns: 1fr;
		}
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
		.error,
		.editor-heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.editable-topics li {
			grid-template-columns: auto minmax(0, 1fr);
			margin-left: calc(var(--topic-level) * 0.65rem);
		}

		.topic-controls {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}

		.coverage-summary strong {
			font-size: 3rem;
		}
	}
</style>