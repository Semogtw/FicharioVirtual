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

	function dropped(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		queue(Array.from(event.dataTransfer?.files ?? []));
	}

	function dragged(event: DragEvent) {
		event.preventDefault();
		dragging = true;
	}

	function left(event: DragEvent) {
		const current = event.currentTarget as HTMLElement;
		const related = event.relatedTarget;
		if (!(related instanceof Node) || !current.contains(related)) dragging = false;
	}

	async function loadNotebookOptions(version = notebookRequests.next()) {
		notebookLoading = true;
		notebookError = null;
		try {
			const items = await listNotebooks();
			if (notebookRequests.isCurrent(version)) {
				notebooks = items;
				notebookOptionsReady = true;
			}
		} catch {
			if (notebookRequests.isCurrent(version)) {
				notebookError = 'Não foi possível carregar os cadernos agora.';
				notebookOptionsReady = false;
			}
		} finally {
			if (notebookRequests.isCurrent(version)) notebookLoading = false;
		}
	}

	$effect(() => {
		void loadNotebookOptions();
	});

	$effect(() => {
		if (!notebookOptionsReady) return;
		if (requestedNotebookUnavailable) return;
		const next = importSelectionUrl(page.url, notebookId);
		if (`${next.pathname}${next.search}` !== `${page.url.pathname}${page.url.search}`) {
			replaceState(next, {});
		}
	});

	onDestroy(() => {
		notebookRequests.next();
	});
</script>

<div class="page">
	<header>
		<p class="eyebrow">Entrada unificada</p>
		<h1>Adicionar ao fichário</h1>
		<p>
			Solte fotos e PDFs juntos. O dispositivo cuida só da preparação necessária e a leitura
			automática continua em segundo plano depois que o material já está salvo.
		</p>
	</header>

	<section class="options" aria-label="Destino e preparo">
		<label>
			<span>Salvar em</span>
			<NativeSelect bind:value={notebookId} disabled={notebookLoading || notebooks.length === 0}>
				<option value="">Nenhum caderno específico</option>
				{#each notebooks as notebook (notebook.id)}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</NativeSelect>
		</label>
		<fieldset>
			<legend>Fotos</legend>
			<label class="choice">
				<input type="radio" name="image-mode" value="standard" bind:group={mode} />
				<span><strong>Documento</strong><small>Limpa fundo e melhora legibilidade.</small></span>
			</label>
			<label class="choice">
				<input type="radio" name="image-mode" value="original" bind:group={mode} />
				<span><strong>Original</strong><small>Guarda a foto sem transformação.</small></span>
			</label>
		</fieldset>
	</section>

	{#if notebookError}<p class="selection-error" role="alert">{notebookError}</p>{/if}
	{#if requestedNotebookUnavailable}
		<p class="selection-error" role="alert">
			O caderno solicitado não está disponível. Escolha outro destino antes de adicionar arquivos.
		</p>
	{/if}

	<section
		class:dragging
		class="drop-zone"
		ondragover={dragged}
		ondragleave={left}
		ondrop={dropped}
	>
		<div class="drop-icon" aria-hidden="true">+</div>
		<h2>Fotos e PDFs entram na mesma fila</h2>
		<p>JPG, PNG, WebP e PDF. Você pode escolher vários de uma vez.</p>
		<div class="actions">
			<label class="file-button">
				Escolher arquivos
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

	{#if selectionMessage}
		<p class="selection-message" role="status" aria-live="polite" aria-atomic="true">
			{selectionMessage}
		</p>
	{/if}
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
		margin: 0;
		font-size: clamp(1.35rem, 3vw, 2rem);
	}

	.drop-zone p {
		margin: 0;
		color: var(--muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
		margin-top: 0.45rem;
	}

	.file-button,
	.camera-button {
		position: relative;
		padding: 0.72rem 1rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		font-weight: 760;
		cursor: pointer;
	}

	.file-button:focus-within,
	.camera-button:focus-within {
		outline: 0.1875rem solid var(--focus);
		outline-offset: 0.1875rem;
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
	.selection-error {
		margin: 0;
		padding: 0.85rem 1rem;
		border-radius: var(--radius-sm);
	}

	.selection-message {
		background: var(--success-soft);
		color: var(--success);
	}

	.selection-error {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.background-note {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.9rem;
		align-items: start;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.background-note > div:first-child {
		width: 2.2rem;
		height: 2.2rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--archive-soft);
		color: var(--archive);
		font-weight: 900;
	}

	.background-note h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}

	@media (max-width: 760px) {
		.options {
			grid-template-columns: 1fr;
		}
	}
</style>
