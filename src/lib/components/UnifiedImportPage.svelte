<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import type { ImagePreparationMode } from '$lib/import/image-types';
	import {
		importSelectionUrl,
		parseRequestedNotebookId,
		resolveImportNotebookSelection
	} from '$lib/import/notebook-selection';
	import { listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';
	import { addImages } from '$lib/stores/import-queue.svelte';
	import { addPdfs } from '$lib/stores/pdf-import-queue.svelte';

	const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
	const notebookRequests = new RequestVersion();
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookOptionsReady = $state(false);
	let notebookLoading = $state(true);
	let notebookError = $state<string | null>(null);
	let mode = $state<ImagePreparationMode>('standard');
	let dragging = $state(false);
	let selectionMessage = $state<string | null>(null);
	let selectionError = $state<string | null>(null);

	let requestedNotebookId = $derived(parseRequestedNotebookId(page.url.searchParams));
	let notebookSelection = $derived(
		resolveImportNotebookSelection(requestedNotebookId, notebooks, notebookOptionsReady)
	);
	let notebookId = $derived(notebookSelection.notebookId);
	let requestedNotebookUnavailable = $derived(
		requestedNotebookId !== null && notebookOptionsReady && notebookSelection.requiresResolution
	);

	function queue(files: readonly File[]) {
		selectionMessage = null;
		selectionError = null;
		if (notebookSelection.requiresResolution) {
			selectionError = 'O caderno solicitado precisa ser confirmado antes da importação.';
			return;
		}

		const images = files.filter((file) => imageTypes.has(file.type));
		const pdfs = files.filter((file) => file.type === 'application/pdf');
		const unsupported = files.length - images.length - pdfs.length;
		let queued = 0;

		if (pdfs.length > 0) {
			addPdfs(pdfs, { notebookId: notebookId || null });
			queued += pdfs.length;
		}
		if (images.length > 0) {
			addImages(images, { mode, notebookId: notebookId || null });
			queued += images.length;
		}

		if (unsupported > 0) {
			selectionError = `${unsupported} arquivo(s) ignorado(s). Use PDF, JPG, PNG ou WebP.`;
		}
		if (queued > 0) {
			selectionMessage = `${queued} arquivo(s) adicionados à fila global. Você já pode navegar pelo Fichário.`;
		}
	}

	function selected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		queue(Array.from(input.files ?? []));
		input.value = '';
	}

	function drop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		queue(Array.from(event.dataTransfer?.files ?? []));
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

<div class="page" aria-labelledby="import-title">
	<header>
		<p class="eyebrow">Entrada de materiais</p>
		<h1 id="import-title">Adicionar ao fichário</h1>
		<p>
			Selecione fotos e PDFs juntos. Eles entram na mesma fila visual; cada formato mantém o fluxo
			mais seguro por baixo.
		</p>
	</header>

	<section class="options" aria-label="Opções da importação">
		<label>
			<span>Caderno</span>
			<NativeSelect
				bind:value={notebookId}
				disabled={notebookLoading || !notebookOptionsReady}
				onchange={selectNotebook}
			>
				<option value="">Sem caderno</option>
				{#each notebooks as notebook}<option value={notebook.id}>{notebook.name}</option>{/each}
			</NativeSelect>
		</label>

		<fieldset>
			<legend>Fotos</legend>
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
		<div class="notice warning" role="status">
			<p>{notebookError}</p>
			<button type="button" onclick={() => void loadNotebookOptions()}>Tentar novamente</button>
		</div>
	{:else if requestedNotebookUnavailable}
		<div class="notice warning" role="alert">
			<p>O caderno solicitado não está disponível.</p>
			<button type="button" onclick={clearRequestedNotebook}>Continuar sem caderno</button>
		</div>
	{/if}

	<section
		class="drop-zone"
		class:dragging
		aria-label="Área para adicionar fotos e PDFs"
		ondragenter={(event) => {
			event.preventDefault();
			dragging = true;
		}}
		ondragover={(event) => event.preventDefault()}
		ondragleave={() => (dragging = false)}
		ondrop={drop}
	>
		<div class="drop-icon" aria-hidden="true">＋</div>
		<h2>Fotos e PDFs podem entrar juntos</h2>
		<p>PDF, JPG, PNG e WebP · selecione quantos arquivos precisar.</p>
		<div class="picker-actions">
			<label class="file-button">
				Selecionar arquivos
				<input
					type="file"
					accept="application/pdf,image/jpeg,image/png,image/webp"
					multiple
					onchange={selected}
				/>
			</label>
			<label class="camera-button">
				Usar câmera
				<input type="file" accept="image/*" capture="environment" onchange={selected} />
			</label>
		</div>
	</section>

	{#if selectionMessage}<p class="selection-message" role="status">{selectionMessage}</p>{/if}
	{#if selectionError}<p class="selection-error" role="alert">{selectionError}</p>{/if}

	<section class="background-note" aria-labelledby="background-title">
		<div aria-hidden="true">↗</div>
		<div>
			<h2 id="background-title">Não precisa ficar nesta tela</h2>
			<p>
				Enquanto a fila mostrar <strong>Preparando</strong> ou <strong>Enviando</strong>, o
				dispositivo ainda está garantindo o arquivo e, em PDFs digitalizados, preparando as páginas
				necessárias. Depois de <strong>Leitura em segundo plano</strong>, o material já está salvo e
				o OCR continua no servidor mesmo se você fechar o Fichário.
			</p>
		</div>
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: 1.4rem;
	}

	header {
		max-width: 52rem;
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

	header > p:last-child,
	.background-note p {
		margin: 0;
		color: var(--muted);
		line-height: 1.6;
	}

	.options {
		display: grid;
		grid-template-columns: minmax(12rem, 0.45fr) minmax(22rem, 1fr);
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.options > label,
	fieldset {
		display: grid;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.options > label > span,
	legend {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 740;
	}

	fieldset {
		grid-template-columns: 1fr 1fr;
	}

	legend {
		grid-column: 1 / -1;
	}

	.choice {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.choice span {
		display: grid;
		gap: 0.15rem;
	}

	.choice small {
		color: var(--muted);
		line-height: 1.4;
	}

	.drop-zone {
		display: grid;
		justify-items: center;
		gap: 0.55rem;
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

	.drop-icon {
		width: 3.5rem;
		height: 3.5rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--archive-soft);
		color: var(--archive);
		font-size: 2rem;
	}

	.drop-zone h2 {
		margin: 0.4rem 0 0;
	}

	.drop-zone p {
		margin: 0;
		color: var(--muted);
	}

	.picker-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.7rem;
		margin-top: 0.7rem;
	}

	.file-button,
	.camera-button,
	.notice button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.65rem 1rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		font-weight: 760;
		cursor: pointer;
	}

	.file-button {
		background: var(--archive);
		color: white;
	}

	.camera-button,
	.notice button {
		background: var(--surface-strong);
		color: var(--archive);
	}

	.file-button input,
	.camera-button input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.selection-message,
	.selection-error,
	.notice {
		margin: 0;
		padding: 0.8rem 1rem;
		border-radius: var(--radius-sm);
	}

	.selection-message {
		background: var(--archive-soft);
		color: var(--archive);
	}

	.selection-error,
	.warning {
		background: rgb(155 63 54 / 9%);
		color: var(--danger);
	}

	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.notice p {
		margin: 0;
	}

	.background-note {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 1rem;
		padding: 1.1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.background-note > div:first-child {
		width: 2.5rem;
		height: 2.5rem;
		display: grid;
		place-items: center;
		border-radius: 0.65rem;
		background: var(--archive-soft);
		color: var(--archive);
		font-size: 1.2rem;
	}

	.background-note h2 {
		margin: 0 0 0.35rem;
		font-size: 1.35rem;
	}

	@media (max-width: 720px) {
		.options,
		fieldset {
			grid-template-columns: 1fr;
		}
	}
</style>
