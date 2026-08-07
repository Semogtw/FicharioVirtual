<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import {
		importSelectionUrl,
		parseRequestedNotebookId,
		resolveImportNotebookSelection
	} from '$lib/import/notebook-selection';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';
	import {
		addPdfs,
		cancelPdfImport,
		clearFinishedPdfImports,
		pdfImportQueue,
		removePdfImport,
		retryPdfImport,
		type PdfQueueItem
	} from '$lib/stores/pdf-import-queue.svelte';

	const notebookRequests = new RequestVersion();
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookOptionsReady = $state(false);
	let notebookLoading = $state(true);
	let notebookError = $state<string | null>(null);
	let consent = $state(false);
	let error = $state<string | null>(null);
	let dragging = $state(false);

	let requestedNotebookId = $derived(parseRequestedNotebookId(page.url.searchParams));
	let notebookSelection = $derived(
		resolveImportNotebookSelection(requestedNotebookId, notebooks, notebookOptionsReady)
	);
	let notebookId = $derived(notebookSelection.notebookId);
	let requestedNotebookUnavailable = $derived(
		requestedNotebookId !== null && notebookOptionsReady && notebookSelection.requiresResolution
	);

	const labels = {
		queued: 'Na fila',
		inspecting: 'Analisando páginas',
		uploading: 'Enviando o PDF original',
		rendering: 'Preparando páginas sem texto',
		publishing: 'Publicando o documento',
		reading: 'Lendo páginas em lotes',
		waiting: 'Leitura pendente',
		needs_review: 'Pronto para revisão',
		complete: 'Importação concluída',
		duplicate: 'Já existe no fichário',
		failed: 'Falha na importação',
		cancelled: 'Cancelado'
	} satisfies Record<PdfQueueItem['status'], string>;

	function choose(files: readonly File[]) {
		error = null;
		if (notebookSelection.requiresResolution) {
			error = 'O caderno solicitado precisa ser confirmado antes da importação.';
			return;
		}
		const pdfs = files.filter((file) => file.type === 'application/pdf');
		if (pdfs.length !== files.length) error = 'Selecione somente arquivos PDF.';
		if (pdfs.length > 0) addPdfs(pdfs, { notebookId: notebookId || null, consentGranted: consent });
	}

	function selected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		choose(Array.from(input.files ?? []));
		input.value = '';
	}

	function drop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		choose(Array.from(event.dataTransfer?.files ?? []));
	}

	function canCancel(item: PdfQueueItem) {
		return ['queued', 'inspecting', 'uploading', 'rendering', 'reading'].includes(item.status);
	}

	function canRetry(item: PdfQueueItem) {
		return ['failed', 'cancelled', 'waiting'].includes(item.status);
	}

	function canOpen(item: PdfQueueItem) {
		return (
			['complete', 'needs_review', 'waiting', 'failed'].includes(item.status) &&
			item.result !== null
		);
	}

	function selectNotebook(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		notebookId = select.value;
		replaceState(importSelectionUrl(page.url, notebookId), page.state);
	}

	async function loadNotebookOptions(version = notebookRequests.next()) {
		notebookLoading = true;
		notebookOptionsReady = false;
		notebookError = null;
		try {
			const items = await listNotebooks();
			if (!notebookRequests.isCurrent(version)) return;
			notebooks = items;
			notebookOptionsReady = true;
		} catch {
			if (notebookRequests.isCurrent(version)) {
				notebookError = 'Não foi possível carregar os cadernos para a importação.';
			}
		} finally {
			if (notebookRequests.isCurrent(version)) notebookLoading = false;
		}
	}

	function clearRequestedNotebook() {
		notebookId = '';
		replaceState(importSelectionUrl(page.url, ''), page.state);
	}

	$effect(() => void loadNotebookOptions());
	onDestroy(() => notebookRequests.next());
</script>

<svelte:head><title>Importar PDFs — Fichário Virtual</title></svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Roteamento seletivo</p>
			<h1 id="page-title">Importar PDFs</h1>
			<p>
				O original permanece intacto. Texto nativo é indexado localmente e somente páginas visuais
				são preparadas em lotes temporários para OCR.
			</p>
		</div>
		{#if pdfImportQueue.items.some( (item) => ['complete', 'needs_review', 'duplicate', 'cancelled'].includes(item.status) )}
			<Button label="Limpar concluídos" variant="secondary" onclick={clearFinishedPdfImports} />
		{/if}
	</header>

	<section class="options" aria-label="Opções do PDF">
		<label>
			<span>Caderno</span>
			<select
				bind:value={notebookId}
				disabled={notebookLoading || !notebookOptionsReady}
				onchange={selectNotebook}
			>
				<option value="">Sem caderno</option>
				{#each notebooks as notebook}<option value={notebook.id}>{notebook.name}</option>{/each}
			</select>
		</label>
		<label class="consent">
			<input type="checkbox" bind:checked={consent} />
			<span>
				<strong>Permitir OCR quando uma página não possuir texto</strong>
				<small>
					PDFs textuais não usam o provedor. Em digitalizações, somente as páginas necessárias são
					encaminhadas e cada resultado continua associado à página original.
				</small>
			</span>
		</label>
	</section>

	{#if notebookError}
		<div class="notebook-warning" role="status">
			<p>{notebookError}</p>
			<button type="button" onclick={() => void loadNotebookOptions()}>Tentar novamente</button>
		</div>
	{:else if requestedNotebookUnavailable}
		<div class="notebook-warning" role="alert">
			<p>O caderno solicitado não está disponível.</p>
			<button type="button" onclick={clearRequestedNotebook}>Continuar sem caderno</button>
		</div>
	{/if}

	<section
		aria-label="Área para importar PDFs"
		class:dragging
		class="drop-zone"
		ondragenter={(event) => {
			event.preventDefault();
			dragging = true;
		}}
		ondragover={(event) => event.preventDefault()}
		ondragleave={() => (dragging = false)}
		ondrop={drop}
	>
		<div class="pdf-mark" aria-hidden="true">PDF</div>
		<h2>Solte seus PDFs aqui</h2>
		<p>
			Não há teto artificial de 20 MB. A capacidade depende do armazenamento e do dispositivo;
			páginas de OCR são divididas automaticamente em lotes seguros.
		</p>
		<label class="file-button"
			>Selecionar PDFs<input
				type="file"
				accept="application/pdf"
				multiple
				onchange={selected}
			/></label
		>
	</section>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if pdfImportQueue.items.length > 0}
		<section class="queue" aria-labelledby="queue-title">
			<div class="queue-heading">
				<div>
					<p class="eyebrow">Fila sequencial</p>
					<h2 id="queue-title">PDFs</h2>
				</div>
				<span>{pdfImportQueue.items.length} itens</span>
			</div>
			<ul>
				{#each pdfImportQueue.items as item (item.id)}
					<li>
						<div class="file-icon" aria-hidden="true">PDF</div>
						<div class="item-copy">
							<strong>{item.file.name}</strong>
							<span class={`status ${item.status}`}>{labels[item.status]}</span>
							{#if item.progress}
								<small
									>{item.progress.completed}/{item.progress.total}{#if item.progress.pageNumber}
										· página {item.progress.pageNumber}{/if}</small
								>
							{/if}
							{#if item.result}
								<small>
									{item.result.pageCount} páginas · {item.result.ocrPageCount} encaminhadas para OCR
									{#if item.result.ocrFailed > 0}
										· {item.result.ocrFailed} falharam{/if}
								</small>
							{/if}
							{#if item.error}<p>{item.error}</p>{/if}
						</div>
						<div class="actions">
							{#if canCancel(item)}
								<button type="button" onclick={() => cancelPdfImport(item.id)}>Cancelar</button>
							{:else if canRetry(item)}
								<button type="button" onclick={() => void retryPdfImport(item.id)}>Retomar</button>
								<button type="button" onclick={() => removePdfImport(item.id)}
									>Remover da lista</button
								>
							{/if}
							{#if canOpen(item) && item.result}<a href={`/documents/${item.result.documentId}/`}
									>{item.status === 'needs_review' ? 'Revisar' : 'Abrir'}</a
								>{/if}
							{#if item.status === 'duplicate' && item.duplicateDocumentId}<a
									href={`/documents/${item.duplicateDocumentId}/`}>Abrir existente</a
								>{/if}
							{#if ['complete', 'needs_review', 'duplicate'].includes(item.status)}<button
									type="button"
									onclick={() => removePdfImport(item.id)}>Ocultar</button
								>{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.page,
	.queue {
		display: grid;
		gap: 1.35rem;
	}
	header,
	.queue-heading {
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
	header p:last-child {
		max-width: 52rem;
		margin-bottom: 0;
		color: var(--muted);
		line-height: 1.6;
	}
	.options {
		display: grid;
		grid-template-columns: minmax(12rem, 0.4fr) minmax(22rem, 1fr);
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.options > label:first-child {
		display: grid;
		gap: 0.4rem;
	}
	.options label > span:first-child {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 740;
	}
	select {
		min-height: 3rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
	}
	.consent {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.8rem;
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
	}
	.consent input {
		width: 1.1rem;
		height: 1.1rem;
		margin-top: 0.2rem;
	}
	.consent span,
	.item-copy {
		display: grid;
		gap: 0.25rem;
	}
	.consent small,
	.queue-heading > span,
	.item-copy small {
		color: var(--muted);
	}
	.drop-zone {
		display: grid;
		justify-items: center;
		padding: clamp(2rem, 7vw, 4.5rem);
		border: 0.125rem dashed var(--line-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
		text-align: center;
	}
	.drop-zone.dragging {
		border-color: var(--archive);
		background: var(--archive-soft);
	}
	.pdf-mark,
	.file-icon {
		display: grid;
		place-items: center;
		background: var(--accent);
		color: white;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.08em;
	}
	.pdf-mark {
		width: 4rem;
		height: 4.5rem;
		margin-bottom: 1rem;
		border-radius: 0.35rem;
		box-shadow: var(--shadow-soft);
	}
	.drop-zone h2 {
		margin-bottom: 0.4rem;
		font-size: clamp(1.5rem, 4vw, 2.25rem);
	}
	.drop-zone p {
		max-width: 48rem;
		margin-bottom: 1.25rem;
		color: var(--muted);
	}
	.file-button,
	.actions button,
	.actions a {
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.8rem;
		border-radius: var(--radius-sm);
		font-weight: 740;
		cursor: pointer;
	}
	.file-button {
		position: relative;
		background: var(--archive);
		color: white;
	}
	.file-button input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.notebook-warning,
	.error {
		padding: 0.8rem 1rem;
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
	}
	.notebook-warning {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.notebook-warning p,
	.error {
		margin: 0;
	}
	.error {
		border-color: var(--danger);
		color: var(--danger);
	}
	.notebook-warning button,
	.actions button,
	.actions a {
		border: 1px solid var(--line-strong);
		background: var(--surface-strong);
		color: var(--ink);
	}
	.queue-heading h2 {
		margin-bottom: 0;
		font-size: 2rem;
	}
	ul {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.9rem;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.file-icon {
		width: 3.5rem;
		height: 4rem;
		border-radius: 0.3rem;
	}
	.item-copy {
		min-width: 0;
	}
	.item-copy > strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.status {
		width: fit-content;
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 740;
	}
	.status.waiting,
	.status.needs_review,
	.status.duplicate {
		color: var(--accent-strong);
	}
	.status.failed,
	.status.cancelled,
	.item-copy p {
		color: var(--danger);
	}
	.item-copy p {
		margin: 0.15rem 0 0;
		font-size: 0.78rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.4rem;
	}
	.actions button,
	.actions a {
		min-height: 2.35rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.78rem;
	}
	@media (max-width: 760px) {
		.options {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 600px) {
		header {
			align-items: flex-start;
			flex-direction: column;
		}
		li {
			grid-template-columns: 3.5rem minmax(0, 1fr);
		}
		.actions {
			grid-column: 1/-1;
			justify-content: flex-start;
		}
	}
</style>
