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
	import type { ImagePreparationMode } from '$lib/import/image-types';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';
	import {
		addImages,
		cancelImport,
		clearFinishedImports,
		importQueue,
		removeImport,
		retryImport,
		type ImportQueueItem
	} from '$lib/stores/import-queue.svelte';

	const notebookRequests = new RequestVersion();
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookOptionsReady = $state(false);
	let notebookLoading = $state(true);
	let notebookError = $state<string | null>(null);
	let notebookId = $state('');
	let mode = $state<ImagePreparationMode>('standard');
	let consent = $state(false);
	let dragging = $state(false);
	let selectionError = $state<string | null>(null);

	let requestedNotebookId = $derived(parseRequestedNotebookId(page.url.searchParams));
	let notebookSelection = $derived(
		resolveImportNotebookSelection(requestedNotebookId, notebooks, notebookOptionsReady)
	);
	let requestedNotebookUnavailable = $derived(
		requestedNotebookId !== null && notebookOptionsReady && notebookSelection.requiresResolution
	);

	const statusLabels = {
		queued: 'Na fila',
		preparing: 'Preparando no dispositivo',
		uploading: 'Enviando com segurança',
		reading: 'Lendo a página',
		waiting: 'Leitura pendente',
		needs_review: 'Pronto para revisão',
		complete: 'Importação concluída',
		duplicate: 'Já existe no fichário',
		failed: 'Falha na importação',
		cancelled: 'Cancelado'
	} satisfies Record<ImportQueueItem['status'], string>;

	function formatBytes(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function queue(files: readonly File[]) {
		selectionError = null;
		if (notebookSelection.requiresResolution) {
			selectionError = 'O caderno solicitado precisa ser confirmado antes da importação.';
			return;
		}
		if (!consent) {
			selectionError = 'Confirme o aviso de privacidade antes de enviar imagens para leitura.';
			return;
		}
		const images = files.filter((file) =>
			['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
		);
		if (images.length !== files.length) {
			selectionError = 'Nesta etapa, selecione somente imagens JPG, PNG ou WebP.';
		}
		if (images.length > 0) addImages(images, { mode, notebookId: notebookId || null });
	}

	function selectFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		queue(Array.from(input.files ?? []));
		input.value = '';
	}

	function drop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		queue(Array.from(event.dataTransfer?.files ?? []));
	}

	function canCancel(item: ImportQueueItem) {
		return item.status === 'preparing' || item.status === 'uploading';
	}

	function canRetry(item: ImportQueueItem) {
		return item.status === 'failed' || item.status === 'cancelled' || item.status === 'waiting';
	}

	function canOpen(item: ImportQueueItem) {
		return (item.status === 'complete' || item.status === 'needs_review') && item.result !== null;
	}

	function selectNotebook(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		notebookId = select.value;
		const url = importSelectionUrl(page.url, notebookId);
		replaceState(url, page.state);
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
		const url = importSelectionUrl(page.url, '');
		replaceState(url, page.state);
	}

	$effect(() => {
		void loadNotebookOptions();
	});

	$effect(() => {
		notebookId = notebookSelection.notebookId;
	});

	onDestroy(() => {
		notebookRequests.next();
	});
</script>

<svelte:head>
	<title>Importar — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Entrada do arquivo</p>
			<h1 id="page-title">Importar imagens</h1>
			<p>
				A preparação e a miniatura acontecem no dispositivo. O arquivo privado permanece salvo mesmo
				quando a leitura precisa ser retomada mais tarde.
			</p>
		</div>
		{#if importQueue.items.some( (item) => ['complete', 'needs_review', 'duplicate', 'cancelled'].includes(item.status) )}
			<Button label="Limpar concluídos" variant="secondary" onclick={clearFinishedImports} />
		{/if}
	</header>

	<section class="settings" aria-label="Opções da importação">
		<label>
			<span>Caderno</span>
			<select
				bind:value={notebookId}
				disabled={notebookLoading || !notebookOptionsReady}
				onchange={selectNotebook}
			>
				<option value="">Sem caderno</option>
				{#each notebooks as notebook}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</select>
		</label>
		<fieldset>
			<legend>Definição</legend>
			<label class="choice">
				<input type="radio" bind:group={mode} value="standard" />
				<span><strong>Padrão</strong><small>Até 2.560 px · recomendado</small></span>
			</label>
			<label class="choice">
				<input type="radio" bind:group={mode} value="high-definition" />
				<span><strong>Alta definição</strong><small>Até 3.200 px · texto muito pequeno</small></span
				>
			</label>
		</fieldset>
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

	<label class="consent">
		<input type="checkbox" bind:checked={consent} />
		<span>
			<strong>Autorizo a leitura automática destas imagens.</strong>
			<small>
				No nível gratuito do provedor, o conteúdo pode ser usado para melhorar produtos. A chave
				nunca fica neste navegador e nenhuma cobrança é ativada automaticamente.
			</small>
		</span>
	</label>

	<section
		aria-label="Área para importar imagens"
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
		<div aria-hidden="true" class="drop-icon">＋</div>
		<h2>Solte fotos ou capturas aqui</h2>
		<p>JPG, PNG ou WebP, até 12 MB cada.</p>
		<div class="picker-actions">
			<label class="file-button">
				Selecionar imagens
				<input
					type="file"
					accept="image/jpeg,image/png,image/webp"
					multiple
					onchange={selectFiles}
				/>
			</label>
			<label class="camera-button">
				Usar câmera
				<input type="file" accept="image/*" capture="environment" onchange={selectFiles} />
			</label>
		</div>
	</section>

	{#if selectionError}
		<p class="selection-error" role="alert">{selectionError}</p>
	{/if}

	{#if importQueue.items.length > 0}
		<section class="queue" aria-labelledby="queue-title">
			<div class="queue-heading">
				<div>
					<p class="eyebrow">Fila local</p>
					<h2 id="queue-title">Importações</h2>
				</div>
				<span>{importQueue.items.length} itens</span>
			</div>

			<ul>
				{#each importQueue.items as item (item.id)}
					<li>
						<div class="preview">
							{#if item.previewUrl}
								<img src={item.previewUrl} alt="" />
							{:else}
								<span aria-hidden="true">IMG</span>
							{/if}
						</div>
						<div class="item-copy">
							<strong>{item.file.name}</strong>
							<small>
								{formatBytes(item.file.size)}
								{#if item.preparedBytes !== null}
									→ {formatBytes(item.preparedBytes)}
								{/if}
							</small>
							<span class={`status ${item.status}`}>{statusLabels[item.status]}</span>
							{#if item.error}<p>{item.error}</p>{/if}
						</div>
						<div class="item-actions">
							{#if canCancel(item)}
								<button type="button" onclick={() => cancelImport(item.id)}>Cancelar</button>
							{:else if canRetry(item)}
								<button type="button" onclick={() => retryImport(item.id)}>Retomar</button>
								<button type="button" onclick={() => removeImport(item.id)}>Remover da lista</button
								>
							{:else if canOpen(item) && item.result}
								<a href={`/documents/${item.result.documentId}/`}>
									{item.status === 'needs_review' ? 'Revisar' : 'Abrir'}
								</a>
								<button type="button" onclick={() => removeImport(item.id)}>Ocultar</button>
							{:else if item.status === 'duplicate' && item.duplicateDocumentId}
								<a href={`/documents/${item.duplicateDocumentId}/`}>Abrir existente</a>
								<button type="button" onclick={() => removeImport(item.id)}>Ocultar</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1.4rem;
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
		max-width: 48rem;
		margin-bottom: 0;
		color: var(--muted);
		line-height: 1.6;
	}

	.settings {
		display: grid;
		grid-template-columns: minmax(12rem, 0.45fr) minmax(22rem, 1fr);
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.settings > label,
	fieldset {
		display: grid;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.settings > label > span,
	legend {
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

	fieldset {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	legend {
		grid-column: 1 / -1;
	}

	.choice,
	.consent {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
	}

	.choice {
		min-height: 3rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.choice span,
	.consent span {
		display: grid;
		gap: 0.2rem;
	}

	.choice small,
	.consent small {
		color: var(--muted);
	}

	.consent {
		padding: 1rem;
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
	}

	.consent input {
		width: 1.1rem;
		height: 1.1rem;
		margin-top: 0.18rem;
	}

	.consent small {
		max-width: 68rem;
		line-height: 1.5;
	}

	.drop-zone {
		display: grid;
		justify-items: center;
		padding: clamp(2rem, 7vw, 4.5rem);
		border: 0.125rem dashed var(--line-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
		text-align: center;
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}

	.drop-zone.dragging {
		border-color: var(--archive);
		background: var(--archive-soft);
	}

	.drop-icon {
		width: 3.5rem;
		height: 3.5rem;
		display: grid;
		place-items: center;
		margin-bottom: 1rem;
		border-radius: 50%;
		background: var(--archive-soft);
		color: var(--archive);
		font-size: 1.8rem;
	}

	.drop-zone h2 {
		margin-bottom: 0.4rem;
		font-size: clamp(1.5rem, 4vw, 2.25rem);
	}

	.drop-zone p {
		margin-bottom: 1.25rem;
		color: var(--muted);
	}

	.picker-actions,
	.item-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.picker-actions {
		justify-content: center;
	}

	.file-button,
	.camera-button,
	.item-actions button,
	.item-actions a {
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		padding: 0.65rem 0.9rem;
		border-radius: var(--radius-sm);
		font-weight: 740;
		cursor: pointer;
	}

	.file-button,
	.camera-button {
		position: relative;
	}

	.file-button {
		background: var(--archive);
		color: white;
	}

	.camera-button,
	.item-actions button,
	.item-actions a {
		border: 1px solid var(--line-strong);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.file-button input,
	.camera-button input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.notebook-warning {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.8rem 1rem;
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
		color: var(--accent-strong);
	}

	.notebook-warning p {
		margin: 0;
	}

	.notebook-warning button {
		min-height: 2.35rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-weight: 720;
		cursor: pointer;
	}

	.selection-error {
		margin: 0;
		padding: 0.8rem 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
	}

	.queue {
		display: grid;
		gap: 0.8rem;
	}

	.queue-heading h2 {
		margin-bottom: 0;
		font-size: 2rem;
	}

	.queue-heading > span,
	.item-copy small {
		color: var(--muted);
		font-size: 0.85rem;
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
		grid-template-columns: 4rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.9rem;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.preview {
		width: 4rem;
		height: 4rem;
		display: grid;
		place-items: center;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: var(--paper);
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 760;
	}

	.preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.item-copy {
		min-width: 0;
		display: grid;
		gap: 0.2rem;
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

	.status.reading {
		color: var(--focus);
	}

	.status.waiting,
	.status.needs_review,
	.status.duplicate {
		color: var(--accent-strong);
	}

	.status.failed,
	.status.cancelled {
		color: var(--danger);
	}

	.item-copy p {
		margin: 0.2rem 0 0;
		color: var(--danger);
		font-size: 0.78rem;
	}

	.item-actions {
		justify-content: flex-end;
	}

	.item-actions button,
	.item-actions a {
		min-height: 2.35rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.78rem;
	}

	@media (max-width: 820px) {
		.settings {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 600px) {
		header {
			align-items: flex-start;
			flex-direction: column;
		}

		fieldset {
			grid-template-columns: 1fr;
		}

		li {
			grid-template-columns: 3.5rem minmax(0, 1fr);
		}

		.item-actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
	}
</style>
