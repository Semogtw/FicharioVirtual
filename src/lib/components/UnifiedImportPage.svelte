<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import type { ImagePreparationMode } from '$lib/import/image-types';
	import {
		importPhotoDocument,
		PartialPhotoDocumentImportError,
		type PhotoDocumentProgress
	} from '$lib/import/multipage-drive-upload';
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
	const MAX_PHOTO_DOCUMENT_PAGES = 100;
	const notebookRequests = new RequestVersion();
	type PhotoGrouping = 'document' | 'separate';
	type DraftPhoto = { id: string; file: File; previewUrl: string };
	type PendingSelection = { files: readonly File[]; draftImages: boolean };

	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookOptionsReady = $state(false);
	let notebookLoading = $state(true);
	let notebookError = $state<string | null>(null);
	let mode = $state<ImagePreparationMode>('standard');
	let dragging = $state(false);
	let selectionMessage = $state<string | null>(null);
	let selectionError = $state<string | null>(null);
	let pendingSelections = $state<PendingSelection[]>([]);
	let photoDraft = $state<DraftPhoto[]>([]);
	let photoGrouping = $state<PhotoGrouping>('document');
	let documentTitle = $state('');
	let savingPhotoDraft = $state(false);
	let photoProgress = $state<PhotoDocumentProgress | null>(null);

	let requestedNotebookId = $derived(parseRequestedNotebookId(page.url.searchParams));
	let notebookSelection = $derived(
		resolveImportNotebookSelection(requestedNotebookId, notebooks, notebookOptionsReady)
	);
	let notebookId = $derived(notebookSelection.notebookId);
	let requestedNotebookUnavailable = $derived(
		requestedNotebookId !== null && notebookOptionsReady && notebookSelection.requiresResolution
	);

	function localId() {
		return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
	}

	function defaultPhotoDocumentTitle(file: File) {
		const value = file.name.replace(/\.[^.]+$/, '').trim();
		return value.slice(0, 240) || 'Anotações';
	}

	function releaseDraftPhoto(photo: DraftPhoto) {
		URL.revokeObjectURL(photo.previewUrl);
	}

	function clearPhotoDraft() {
		for (const photo of photoDraft) releaseDraftPhoto(photo);
		photoDraft = [];
		documentTitle = '';
		photoProgress = null;
		photoGrouping = 'document';
	}

	function stageImages(files: readonly File[]) {
		const remaining = MAX_PHOTO_DOCUMENT_PAGES - photoDraft.length;
		const accepted = files.slice(0, Math.max(0, remaining));
		if (accepted.length < files.length) {
			selectionError = `Um documento de fotos pode ter até ${MAX_PHOTO_DOCUMENT_PAGES} páginas.`;
		}
		if (accepted.length === 0) return;
		const staged = accepted.map((file) => ({
			id: localId(),
			file,
			previewUrl: URL.createObjectURL(file)
		}));
		photoDraft = [...photoDraft, ...staged];
		if (documentTitle.trim().length === 0 && photoDraft[0]) {
			documentTitle = defaultPhotoDocumentTitle(photoDraft[0].file);
		}
		selectionMessage = `${photoDraft.length} foto(s) prontas. Revise a ordem e salve quando terminar.`;
	}

	function removeDraftPhoto(id: string) {
		if (savingPhotoDraft) return;
		const index = photoDraft.findIndex((photo) => photo.id === id);
		if (index < 0) return;
		const [removed] = photoDraft.splice(index, 1);
		if (removed) releaseDraftPhoto(removed);
		photoDraft = [...photoDraft];
		if (photoDraft.length === 0) clearPhotoDraft();
	}

	function moveDraftPhoto(index: number, direction: -1 | 1) {
		if (savingPhotoDraft) return;
		const target = index + direction;
		if (index < 0 || target < 0 || index >= photoDraft.length || target >= photoDraft.length) return;
		const copy = [...photoDraft];
		const current = copy[index];
		const other = copy[target];
		if (!current || !other) return;
		copy[index] = other;
		copy[target] = current;
		photoDraft = copy;
	}

	function enqueue(
		files: readonly File[],
		destinationNotebookId: string,
		options: { draftImages?: boolean } = {}
	) {
		const images = files.filter((file) => imageTypes.has(file.type));
		const pdfs = files.filter((file) => file.type === 'application/pdf');
		const unsupported = files.length - images.length - pdfs.length;
		let queued = 0;

		if (pdfs.length > 0) {
			addPdfs(pdfs, { notebookId: destinationNotebookId || null });
			queued += pdfs.length;
		}
		if (images.length > 0) {
			const shouldDraft = options.draftImages || photoDraft.length > 0 || images.length > 1;
			if (shouldDraft) stageImages(images);
			else {
				addImages(images, { mode, notebookId: destinationNotebookId || null });
				queued += images.length;
			}
		}

		if (unsupported > 0) {
			selectionError = `${unsupported} arquivo(s) ignorado(s). Use PDF, JPG, PNG ou WebP.`;
		}
		if (queued > 0 && photoDraft.length === 0) {
			selectionMessage = `${queued} arquivo(s) adicionados à fila global. Você já pode navegar pelo Fichário.`;
		} else if (queued > 0 && photoDraft.length > 0) {
			selectionMessage = `${queued} arquivo(s) já entraram na fila; ${photoDraft.length} foto(s) aguardam sua revisão.`;
		}
	}

	function queue(files: readonly File[], options: { draftImages?: boolean } = {}) {
		selectionMessage = null;
		selectionError = null;
		if (notebookSelection.requiresResolution) {
			if (!notebookOptionsReady) {
				pendingSelections = [
					...pendingSelections,
					{ files: [...files], draftImages: options.draftImages ?? false }
				];
				selectionMessage = 'Confirmando o caderno antes de adicionar os arquivos…';
				return;
			}
			selectionError = 'O caderno solicitado precisa ser confirmado antes da importação.';
			return;
		}

		enqueue(files, notebookId, options);
	}

	function selected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		queue(Array.from(input.files ?? []));
		input.value = '';
	}

	function captured(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		queue(Array.from(input.files ?? []), { draftImages: true });
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

	async function savePhotoDraft() {
		if (savingPhotoDraft || photoDraft.length === 0) return;
		selectionError = null;
		selectionMessage = null;
		const photos = [...photoDraft];
		const files = photos.map((photo) => photo.file);
		const destinationNotebookId = notebookId || null;

		if (photoGrouping === 'separate' || files.length === 1) {
			addImages(files, { mode, notebookId: destinationNotebookId });
			const count = files.length;
			clearPhotoDraft();
			selectionMessage = `${count} foto(s) adicionadas à fila como documento(s) separado(s).`;
			return;
		}

		savingPhotoDraft = true;
		try {
			const result = await importPhotoDocument(files, {
				mode,
				notebookId: destinationNotebookId,
				title: documentTitle,
				onProgress(progress) {
					photoProgress = progress;
				}
			});
			const count = result.pageIds.length;
			clearPhotoDraft();
			selectionMessage = `Documento salvo com ${count} páginas. A leitura continua em segundo plano.`;
		} catch (error) {
			if (error instanceof PartialPhotoDocumentImportError) {
				clearPhotoDraft();
				selectionError = `${error.message} As páginas já salvas não serão reenviadas.`;
			} else {
				selectionError = error instanceof Error ? error.message : 'Não foi possível salvar o documento.';
				photoProgress = null;
			}
		} finally {
			savingPhotoDraft = false;
		}
	}

	async function loadNotebookOptions(version = notebookRequests.next()) {
		notebookLoading = true;
		notebookError = null;
		try {
			const items = await listNotebooks();
			if (notebookRequests.isCurrent(version)) {
				notebooks = items;
				notebookOptionsReady = true;
				const waiting = pendingSelections;
				pendingSelections = [];
				if (waiting.length > 0) {
					const resolved = resolveImportNotebookSelection(requestedNotebookId, items, true);
					selectionMessage = null;
					selectionError = null;
					if (resolved.requiresResolution) {
						selectionError = 'O caderno solicitado precisa ser confirmado antes da importação.';
					} else {
						for (const pending of waiting) {
							enqueue(pending.files, resolved.notebookId, { draftImages: pending.draftImages });
						}
					}
				}
			}
		} catch {
			if (notebookRequests.isCurrent(version)) {
				pendingSelections = [];
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
		pendingSelections = [];
		notebookRequests.next();
		for (const photo of photoDraft) releaseDraftPhoto(photo);
	});
</script>

<div class="page">
	<header>
		<p class="eyebrow">Entrada unificada</p>
		<h1>Adicionar ao fichário</h1>
		<p>
			Solte fotos e PDFs juntos. Para anotações fotografadas, você pode montar várias páginas
			como um único documento antes de salvar.
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
				<input type="radio" name="image-mode" value="high-definition" bind:group={mode} />
				<span><strong>Alta definição</strong><small>Preserva mais detalhe para letras pequenas.</small></span>
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
		role="group"
		aria-label="Área de importação de arquivos"
		class:dragging
		class="drop-zone"
		ondragover={dragged}
		ondragleave={left}
		ondrop={dropped}
	>
		<div class="drop-icon" aria-hidden="true">+</div>
		<h2>Fotos e PDFs entram por aqui</h2>
		<p>JPG, PNG, WebP e PDF. Várias fotos podem virar um único documento.</p>
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
				{photoDraft.length > 0 ? 'Adicionar página' : 'Digitalizar páginas'}
				<input type="file" accept="image/*" capture="environment" onchange={captured} />
			</label>
		</div>
	</section>

	{#if photoDraft.length > 0}
		<section class="photo-builder" aria-labelledby="photo-builder-title">
			<div class="builder-heading">
				<div>
					<p class="eyebrow">Documento de fotos</p>
					<h2 id="photo-builder-title">{photoDraft.length} página(s)</h2>
				</div>
				{#if !savingPhotoDraft}
					<button class="text-button" type="button" onclick={clearPhotoDraft}>Descartar</button>
				{/if}
			</div>

			<label class="title-field">
				<span>Título</span>
				<input
					type="text"
					maxlength="240"
					bind:value={documentTitle}
					disabled={savingPhotoDraft}
					placeholder="Ex.: Redes — aula 14/08"
				/>
			</label>

			{#if photoDraft.length > 1}
				<fieldset class="grouping">
					<legend>Como salvar</legend>
					<label class="choice compact">
						<input
							type="radio"
							name="photo-grouping"
							value="document"
							bind:group={photoGrouping}
							disabled={savingPhotoDraft}
						/>
						<span><strong>Um documento</strong><small>Cada foto vira uma página.</small></span>
					</label>
					<label class="choice compact">
						<input
							type="radio"
							name="photo-grouping"
							value="separate"
							bind:group={photoGrouping}
							disabled={savingPhotoDraft}
						/>
						<span><strong>Separadas</strong><small>Cria um documento por foto.</small></span>
					</label>
				</fieldset>
			{/if}

			<div class="photo-grid" aria-label="Ordem das páginas">
				{#each photoDraft as photo, index (photo.id)}
					<article class="photo-card">
						<div class="photo-preview">
							<img src={photo.previewUrl} alt={`Prévia da página ${index + 1}`} />
							<span>{index + 1}</span>
						</div>
						<div class="photo-card-actions">
							<button
								type="button"
								onclick={() => moveDraftPhoto(index, -1)}
								disabled={savingPhotoDraft || index === 0}
								aria-label={`Mover página ${index + 1} para antes`}
							>←</button>
							<button
								type="button"
								onclick={() => moveDraftPhoto(index, 1)}
								disabled={savingPhotoDraft || index === photoDraft.length - 1}
								aria-label={`Mover página ${index + 1} para depois`}
							>→</button>
							<button
								type="button"
								onclick={() => removeDraftPhoto(photo.id)}
								disabled={savingPhotoDraft}
								aria-label={`Remover página ${index + 1}`}
							>Remover</button>
						</div>
					</article>
				{/each}
			</div>

			<div class="builder-footer">
				{#if photoProgress}
					<p role="status" aria-live="polite">
						{photoProgress.stage === 'preparing' ? 'Preparando' : 'Salvando'} página
						{photoProgress.pageNumber} de {photoProgress.pageCount}…
					</p>
				{:else}
					<p>Você pode adicionar mais fotos pela câmera antes de salvar.</p>
				{/if}
				<button class="save-button" type="button" onclick={savePhotoDraft} disabled={savingPhotoDraft}>
					{savingPhotoDraft
						? 'Salvando…'
						: photoGrouping === 'document' && photoDraft.length > 1
							? 'Salvar documento'
							: 'Adicionar à fila'}
				</button>
			</div>
		</section>
	{/if}

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
				Depois que o material é salvo, a leitura automática continua em segundo plano. PDFs e fotos
				separadas também continuam usando a fila global normalmente.
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
	fieldset,
	.title-field {
		display: grid;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.options > label > span,
	.title-field > span,
	legend {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 740;
	}

	.options fieldset,
	.grouping {
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

	.choice.compact {
		min-height: 100%;
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
	.camera-button,
	.save-button,
	.text-button,
	.photo-card-actions button {
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		font: inherit;
		font-weight: 760;
		cursor: pointer;
	}

	.file-button,
	.camera-button {
		position: relative;
		padding: 0.72rem 1rem;
		background: var(--surface-strong);
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

	.photo-builder {
		display: grid;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}

	.builder-heading,
	.builder-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.builder-heading .eyebrow,
	.builder-heading h2,
	.builder-footer p {
		margin: 0;
	}

	.title-field input {
		width: 100%;
		padding: 0.75rem 0.85rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: inherit;
		font: inherit;
	}

	.grouping {
		display: grid;
		gap: 0.6rem;
	}

	.photo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 0.75rem;
	}

	.photo-card {
		display: grid;
		gap: 0.45rem;
		min-width: 0;
	}

	.photo-preview {
		position: relative;
		aspect-ratio: 3 / 4;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.photo-preview img {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: cover;
	}

	.photo-preview span {
		position: absolute;
		top: 0.45rem;
		left: 0.45rem;
		min-width: 1.8rem;
		height: 1.8rem;
		display: grid;
		place-items: center;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: var(--surface);
		font-size: 0.8rem;
		font-weight: 800;
	}

	.photo-card-actions {
		display: grid;
		grid-template-columns: auto auto 1fr;
		gap: 0.35rem;
	}

	.photo-card-actions button,
	.text-button {
		padding: 0.5rem 0.6rem;
		background: var(--surface-strong);
		color: inherit;
	}

	.save-button {
		padding: 0.72rem 1rem;
		background: var(--archive);
		color: white;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.builder-footer p {
		color: var(--muted);
		font-size: 0.9rem;
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
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.background-note h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}

	@media (max-width: 720px) {
		.options {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 520px) {
		.options fieldset,
		.grouping {
			grid-template-columns: 1fr;
		}

		.builder-heading,
		.builder-footer {
			align-items: stretch;
			flex-direction: column;
		}

		.save-button {
			width: 100%;
		}
	}
</style>
