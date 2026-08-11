<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import NativeSelect from '$lib/components/ui/native-select/NativeSelect.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { GOOGLE_PICKER_MIME_TYPES } from '$lib/drive/picker';
	import {
		MAX_DIRECT_PICKER_DOWNLOAD_BYTES,
		isGooglePickerConfigured,
		selectGoogleDriveImportSource
	} from '$lib/drive/picker-service';
	import { stageDrivePdfReference, type StagedDrivePdfReference } from '$lib/pdf/drive-reference';
	import {
		importStagedDrivePdfReference,
		type DrivePdfReferenceImportProgress
	} from '$lib/pdf/drive-reference-import';
	import { reconcileOrphanedDrivePdfReferenceCopies } from '$lib/pdf/drive-reference-orphan-reconciliation';
	import {
		listDrivePdfReferences,
		type ResumableDrivePdfReference
	} from '$lib/pdf/drive-reference-resume';
	import { deleteDocument } from '$lib/services/documents';
	import { listNotebooks } from '$lib/services/notebooks';
	import { addImages, importQueue } from '$lib/stores/import-queue.svelte';
	import { addPdfs, pdfImportQueue } from '$lib/stores/pdf-import-queue.svelte';

	const pickerConfigured = isGooglePickerConfigured();
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookId = $state('');
	let loadingNotebooks = $state(true);
	let loadingReferences = $state(true);
	let pendingReferences = $state<readonly ResumableDrivePdfReference[]>([]);
	let resumingDocumentId = $state<string | null>(null);
	let referenceProgress = $state<DrivePdfReferenceImportProgress | null>(null);
	let referenceAbortController: AbortController | null = null;
	let deletingDocumentId = $state<string | null>(null);
	let selecting = $state(false);
	let error = $state<string | null>(null);
	let referenceError = $state<string | null>(null);
	let message = $state<string | null>(null);

	let activeImages = $derived(
		importQueue.items.filter(
			(item) => !['complete', 'duplicate', 'cancelled'].includes(item.status)
		).length
	);
	let activePdfs = $derived(
		pdfImportQueue.items.filter(
			(item) => !['complete', 'duplicate', 'cancelled'].includes(item.status)
		).length
	);

	async function loadNotebooks() {
		loadingNotebooks = true;
		error = null;
		try {
			notebooks = await listNotebooks();
		} catch {
			error = 'Não foi possível carregar os cadernos.';
		} finally {
			loadingNotebooks = false;
		}
	}

	async function loadPendingReferences() {
		loadingReferences = true;
		referenceError = null;
		try {
			pendingReferences = (await listDrivePdfReferences()).filter(
				(reference) => reference.status === 'pending_inspection'
			);
		} catch (caught) {
			referenceError =
				caught instanceof Error
					? caught.message
					: 'Não foi possível carregar os PDFs grandes pendentes.';
		} finally {
			loadingReferences = false;
		}
	}

	function referenceTitle(name: string) {
		const withoutExtension = name.replace(/\.pdf$/i, '').trim();
		return (withoutExtension || 'PDF importado').slice(0, 240);
	}

	function formatSize(bytes: number) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
	}

	function referenceMessage(name: string, pending: number) {
		return pending > 0
			? `“${name}” foi importado por referência; ${pending} página(s) de OCR permanecem retomáveis.`
			: `“${name}” foi importado por referência sem baixar o PDF inteiro.`;
	}

	function referenceProgressMessage(progress: DrivePdfReferenceImportProgress) {
		if (progress.phase === 'inspecting') {
			return `Inspecionando página ${progress.pageNumber ?? 0} de ${progress.pageCount ?? 0}…`;
		}
		if (progress.phase === 'rendering_ocr') {
			return `Preparando página ${progress.current ?? 0} de ${progress.total ?? 0} para OCR…`;
		}
		if (progress.phase === 'ocr') {
			return `Lendo página ${progress.current ?? 0} de ${progress.total ?? 0} com OCR…`;
		}
		const labels: Record<DrivePdfReferenceImportProgress['phase'], string> = {
			verifying: 'Verificando a cópia preservada no Drive…',
			opening: 'Abrindo o PDF por faixas…',
			inspecting: 'Inspecionando páginas…',
			rendering_ocr: 'Preparando páginas para OCR…',
			publishing: 'Publicando a estrutura do documento…',
			ocr: 'Executando OCR…',
			complete: 'Importação concluída.'
		};
		return labels[progress.phase];
	}

	function isAbortError(error: unknown) {
		return error instanceof DOMException && error.name === 'AbortError';
	}

	async function runReferenceImport(staged: StagedDrivePdfReference, name: string) {
		const controller = new AbortController();
		referenceAbortController = controller;
		resumingDocumentId = staged.documentId;
		referenceProgress = null;
		try {
			return await importStagedDrivePdfReference({
				staged,

				signal: controller.signal,
				onProgress: (progress) => {
					referenceProgress = progress;
				}
			});
		} catch (caught) {
			if (isAbortError(caught)) {
				error = null;
				message = `O processamento de “${name}” foi interrompido sem apagar o estado durável. Se ainda houver etapas pendentes, elas poderão ser retomadas.`;
				return null;
			}
			throw caught;
		} finally {
			if (referenceAbortController === controller) referenceAbortController = null;
			referenceProgress = null;
			resumingDocumentId = null;
			await loadPendingReferences();
		}
	}

	function stopReferenceProcessing(reference: ResumableDrivePdfReference) {
		if (resumingDocumentId !== reference.documentId) return;
		const controller = referenceAbortController;
		if (!controller || controller.signal.aborted) return;
		controller.abort();
		message = `Interrompendo “${reference.title}” sem apagar o estado durável…`;
	}

	async function resumeReference(reference: ResumableDrivePdfReference) {
		if (resumingDocumentId !== null || deletingDocumentId !== null || selecting) return;
		error = null;
		message = null;
		try {
			const imported = await runReferenceImport(
				{
					documentId: reference.documentId,
					driveFileId: reference.driveFileId,
					sourceSizeBytes: reference.sourceSizeBytes,
					status: 'pending_inspection'
				},
				reference.title
			);
			if (imported) {
				message = referenceMessage(reference.title, imported.ocrPending + imported.ocrFailed);
			}
		} catch (caught) {
			error =
				caught instanceof Error ? caught.message : 'Não foi possível retomar o PDF preservado.';
		}
	}

	async function cancelReference(reference: ResumableDrivePdfReference) {
		if (deletingDocumentId !== null || resumingDocumentId !== null || selecting) return;
		if (
			!globalThis.confirm(`Excluir a cópia preservada de “${reference.title}” do Google Drive?`)
		) {
			return;
		}
		error = null;
		message = null;
		deletingDocumentId = reference.documentId;
		try {
			await deleteDocument(reference.documentId);
			message = `A cópia preservada de “${reference.title}” foi excluída.`;
		} catch (caught) {
			error =
				caught instanceof Error ? caught.message : 'Não foi possível excluir o PDF preservado.';
		} finally {
			deletingDocumentId = null;
			await loadPendingReferences();
		}
	}

	async function selectFromDrive() {
		if (
			selecting ||
			!pickerConfigured ||
			resumingDocumentId !== null ||
			deletingDocumentId !== null
		)
			return;
		error = null;
		message = null;
		selecting = true;
		try {
			const selected = await selectGoogleDriveImportSource({
				mimeTypes: GOOGLE_PICKER_MIME_TYPES,
				maximumBytes: MAX_DIRECT_PICKER_DOWNLOAD_BYTES
			});
			if (selected === null) return;

			if (selected.kind === 'reference') {
				if (selected.selection.mimeType !== 'application/pdf') {
					throw new Error('Arquivos grandes por referência precisam ser PDFs.');
				}
				const staged = await stageDrivePdfReference({
					selection: selected.selection,
					notebookId: notebookId || null,
					title: referenceTitle(selected.selection.name)
				});
				await loadPendingReferences();
				const imported = await runReferenceImport(staged, selected.selection.name);
				if (imported) {
					message = referenceMessage(
						selected.selection.name,
						imported.ocrPending + imported.ocrFailed
					);
				}
				return;
			}

			if (selected.file.type === 'application/pdf') {
				addPdfs([selected.file], { notebookId: notebookId || null });
				message = `“${selected.file.name}” foi encaminhado à fila de PDFs.`;
			} else if (['image/jpeg', 'image/png', 'image/webp'].includes(selected.file.type)) {
				addImages([selected.file], { mode: 'standard', notebookId: notebookId || null });
				message = `“${selected.file.name}” foi encaminhado à fila de imagens.`;
			} else {
				throw new Error('O tipo selecionado não é compatível com o Fichário.');
			}
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível importar o arquivo do Google Drive.';
		} finally {
			selecting = false;
		}
	}

	onMount(() => {
		void reconcileOrphanedDrivePdfReferenceCopies().catch(() => undefined);
		void Promise.all([loadNotebooks(), loadPendingReferences()]);
	});

	onDestroy(() => {
		referenceAbortController?.abort();
	});
</script>

<svelte:head>
	<title>Importar do Drive — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Seleção consciente</p>
			<h1 id="page-title">Importar do Google Drive</h1>
			<p>
				Escolha exatamente um arquivo. Ele é lido temporariamente e publicado pela mesma fila
				Drive-first dos uploads locais. Nenhuma leitura ampla da conta é realizada.
			</p>
		</div>
	</header>

	{#if !pickerConfigured}
		<section class="notice" aria-labelledby="configuration-title">
			<h2 id="configuration-title">Google Picker ainda não configurado</h2>
			<p>Cadastre a chave pública restrita e o número do projeto para habilitar esta tela.</p>
		</section>
	{/if}

	<section class="options" aria-label="Opções da importação">
		<label>
			<span>Caderno de destino</span>
			<NativeSelect bind:value={notebookId} disabled={loadingNotebooks || selecting}>
				<option value="">Sem caderno</option>
				{#each notebooks as notebook}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</NativeSelect>
		</label>
	</section>

	<section class="picker-card" aria-labelledby="picker-title">
		<div>
			<p class="eyebrow">JPG · PNG · WebP · PDF</p>
			<h2 id="picker-title">Escolher um arquivo</h2>
			<p>
				O download direto no navegador aceita até 50 MiB. PDFs maiores são preservados no Drive e
				preparados por referência; esse teto não é do documento lógico nem dos lotes de OCR.
			</p>
		</div>
		<Button
			label={selecting ? 'Abrindo Drive…' : 'Escolher no Google Drive'}
			disabled={!pickerConfigured ||
				selecting ||
				loadingNotebooks ||
				resumingDocumentId !== null ||
				deletingDocumentId !== null}
			onclick={() => void selectFromDrive()}
		/>
	</section>

	{#if loadingReferences || pendingReferences.length > 0 || referenceError}
		<section class="resume-card" aria-labelledby="resume-title">
			<div>
				<p class="eyebrow">Retomada durável</p>
				<h2 id="resume-title">PDFs grandes preservados</h2>
				<p>
					Esses arquivos já estão na pasta controlada do Drive. Retomar lê somente faixas e páginas
					necessárias; você não precisa selecionar nem enviar o PDF novamente.
				</p>
			</div>
			{#if loadingReferences}
				<p class="muted" role="status">Verificando referências pendentes…</p>
			{:else if referenceError}
				<div class="reference-error">
					<p role="alert">{referenceError}</p>
					<Button label="Tentar carregar novamente" onclick={() => void loadPendingReferences()} />
				</div>
			{:else}
				<div class="reference-list">
					{#each pendingReferences as reference (reference.documentId)}
						<article>
							<div>
								<strong>{reference.title}</strong>
								<small>{formatSize(reference.sourceSizeBytes)} · preservado no Google Drive</small>
							</div>
							<div class="reference-actions">
								{#if resumingDocumentId === reference.documentId}
									<Button
										label="Parar processamento"
										disabled={deletingDocumentId !== null}
										onclick={() => stopReferenceProcessing(reference)}
									/>
								{:else}
									<Button
										label="Retomar"
										disabled={selecting ||
											resumingDocumentId !== null ||
											deletingDocumentId !== null}
										onclick={() => void resumeReference(reference)}
									/>
								{/if}
								<Button
									label={deletingDocumentId === reference.documentId
										? 'Excluindo…'
										: 'Excluir cópia'}
									disabled={selecting || resumingDocumentId !== null || deletingDocumentId !== null}
									onclick={() => void cancelReference(reference)}
								/>
							</div>
							{#if resumingDocumentId === reference.documentId && referenceProgress}
								<p class="reference-progress" role="status">
									{referenceProgressMessage(referenceProgress)}
								</p>
							{/if}
						</article>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	<section class="queues" aria-label="Filas de importação">
		<a href="/import/">
			<strong>Fila de imagens</strong>
			<span>{activeImages} em andamento</span>
		</a>
		<a href="/import/pdf/">
			<strong>Fila de PDFs</strong>
			<span>{activePdfs} em andamento</span>
		</a>
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: 1.25rem;
	}
	.eyebrow {
		margin: 0 0 0.4rem;
		color: var(--archive);
		font-size: 0.74rem;
		font-weight: 780;
		letter-spacing: 0.11em;
		text-transform: uppercase;
	}
	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 540;
	}
	h1 {
		margin: 0 0 0.55rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}
	header p:last-child,
	.notice p,
	.picker-card p,
	.resume-card > div:first-child > p:last-child {
		max-width: 56rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}
	.options,
	.picker-card,
	.resume-card,
	.notice,
	.queues a {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.options {
		display: grid;
		grid-template-columns: minmax(12rem, 24rem);
		gap: 1rem;
	}
	.options > label:first-child {
		display: grid;
		gap: 0.4rem;
	}
	.options > label:first-child span {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 740;
	}
	.queues span,
	.reference-list small,
	.muted {
		color: var(--muted);
		line-height: 1.45;
	}
	.picker-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 10rem;
		border-left: 0.3rem solid var(--archive);
	}
	.picker-card h2,
	.notice h2,
	.resume-card h2 {
		margin: 0 0 0.4rem;
	}
	.notice {
		border-left: 0.3rem solid var(--danger);
	}
	.resume-card {
		display: grid;
		gap: 1rem;
		border-left: 0.3rem solid var(--archive);
	}
	.reference-list {
		display: grid;
		gap: 0.65rem;
	}
	.reference-list article {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.8rem;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}
	.reference-list article > div:first-child {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.reference-progress {
		grid-column: 1 / -1;
		margin: 0;
		color: var(--archive);
		font-size: 0.82rem;
		font-weight: 650;
	}

	.reference-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.reference-list strong,
	.reference-list small {
		overflow-wrap: anywhere;
	}
	.reference-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.reference-error p {
		margin: 0;
		color: var(--danger);
	}
	.queues {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.queues a {
		display: grid;
		gap: 0.3rem;
		color: var(--ink);
	}
	.error,
	.message {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(var(--danger-rgb) / 7%);
		color: var(--danger);
	}
	.message {
		border-color: var(--archive);
		background: var(--archive-soft);
		color: var(--archive);
	}
	@media (max-width: 720px) {
		.options,
		.queues {
			grid-template-columns: 1fr;
		}
		.picker-card,
		.reference-list article,
		.reference-error {
			align-items: stretch;
			flex-direction: column;
		}
		.reference-list article {
			grid-template-columns: 1fr;
		}
		.reference-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
