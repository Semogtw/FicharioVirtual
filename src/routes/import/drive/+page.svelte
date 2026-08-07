<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { GOOGLE_PICKER_MIME_TYPES } from '$lib/drive/picker';
	import {
		MAX_DIRECT_PICKER_DOWNLOAD_BYTES,
		isGooglePickerConfigured,
		selectGoogleDriveImportSource
	} from '$lib/drive/picker-service';
	import { stageDrivePdfReference } from '$lib/pdf/drive-reference';
	import { listNotebooks } from '$lib/services/notebooks';
	import { addImages, importQueue } from '$lib/stores/import-queue.svelte';
	import { addPdfs, pdfImportQueue } from '$lib/stores/pdf-import-queue.svelte';

	const pickerConfigured = isGooglePickerConfigured();
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let notebookId = $state('');
	let loadingNotebooks = $state(true);
	let selecting = $state(false);
	let consent = $state(false);
	let error = $state<string | null>(null);
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

	function referenceTitle(name: string) {
		const withoutExtension = name.replace(/\.pdf$/i, '').trim();
		return (withoutExtension || 'PDF importado').slice(0, 240);
	}

	async function selectFromDrive() {
		if (selecting || !pickerConfigured) return;
		error = null;
		message = null;
		if (!consent) {
			error = 'Confirme a autorização de OCR antes de selecionar o arquivo.';
			return;
		}
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
				await stageDrivePdfReference({
					selection: selected.selection,
					notebookId: notebookId || null,
					title: referenceTitle(selected.selection.name)
				});
				message = `“${selected.selection.name}” foi preservado no Drive e preparado para inspeção por faixas.`;
				return;
			}

			if (selected.file.type === 'application/pdf') {
				addPdfs([selected.file], { notebookId: notebookId || null, consentGranted: true });
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
		void loadNotebooks();
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
			<select bind:value={notebookId} disabled={loadingNotebooks || selecting}>
				<option value="">Sem caderno</option>
				{#each notebooks as notebook}
					<option value={notebook.id}>{notebook.name}</option>
				{/each}
			</select>
		</label>

		<label class="consent">
			<input type="checkbox" bind:checked={consent} disabled={selecting} />
			<span>
				<strong>Permitir OCR somente quando necessário</strong>
				<small>
					Imagens precisam dessa autorização. PDFs preservam texto nativo e enviam apenas páginas
					sem texto ao provedor de leitura.
				</small>
			</span>
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
			disabled={!pickerConfigured || selecting || loadingNotebooks}
			onclick={() => void selectFromDrive()}
		/>
	</section>

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
	.picker-card p {
		max-width: 56rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}
	.options,
	.picker-card,
	.notice,
	.queues a {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.options {
		display: grid;
		grid-template-columns: minmax(12rem, 0.4fr) minmax(20rem, 1fr);
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
		gap: 0.65rem;
		padding: 0.75rem;
		border-left: 0.3rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
	}
	.consent input {
		width: 1.1rem;
		height: 1.1rem;
		margin-top: 0.18rem;
	}
	.consent span {
		display: grid;
		gap: 0.2rem;
	}
	.consent small,
	.queues span {
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
	.notice h2 {
		margin: 0 0 0.4rem;
	}
	.notice {
		border-left: 0.3rem solid var(--danger);
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
		.picker-card {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
