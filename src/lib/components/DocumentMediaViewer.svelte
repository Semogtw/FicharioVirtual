<script lang="ts">
	import { onDestroy } from 'svelte';
	import SearchMatch from '$lib/components/SearchMatch.svelte';
	import WordGeometryOverlay from '$lib/components/WordGeometryOverlay.svelte';
	import { downloadBrowserDriveFile } from '$lib/drive/browser-files';
	import type { PageDetail } from '$lib/domain/page';
	import { openDrivePdfRangeDocument } from '$lib/pdf/drive-range-transport';
	import { renderPdfDocumentPage, renderPdfPage } from '$lib/pdf/renderer';
	import type { DocumentDetail } from '$lib/services/document-detail';
	import { getSupabaseClient } from '$lib/services/supabase';

	interface DocumentMediaViewerProps {
		detail: DocumentDetail;
		page: PageDetail;
		query: string;
	}

	let { detail, page, query }: DocumentMediaViewerProps = $props();
	let renderedUrl = $state<string | null>(null);
	let loading = $state(false);
	let renderError = $state<string | null>(null);
	let generation = 0;
	let ownedObjectUrl: string | null = null;

	function releaseObjectUrl() {
		if (ownedObjectUrl) URL.revokeObjectURL(ownedObjectUrl);
		ownedObjectUrl = null;
	}

	function publishBlob(blob: Blob) {
		releaseObjectUrl();
		ownedObjectUrl = URL.createObjectURL(blob);
		renderedUrl = ownedObjectUrl;
	}

	async function renderSupabasePdf(sourceUrl: string, pageNumber: number) {
		const response = await fetch(sourceUrl, { cache: 'no-store' });
		if (!response.ok) throw new Error('PDF indisponível');
		const blob = await response.blob();
		if (blob.size < 1 || blob.size > 256 * 1024 * 1024) throw new Error('PDF inválido');
		const file = new File([blob], detail.originalFilename, { type: 'application/pdf' });
		return renderPdfPage(file, pageNumber);
	}

	async function drivePdfReferenceSize(documentId: string) {
		const { data, error } = await getSupabaseClient()
			.from('drive_pdf_reference_imports')
			.select('source_size_bytes')
			.eq('document_id', documentId)
			.maybeSingle();
		if (error || !data || !Number.isSafeInteger(data.source_size_bytes) || data.source_size_bytes < 1) {
			return null;
		}
		return data.source_size_bytes;
	}

	async function renderDrivePdf(fileId: string, pageNumber: number) {
		const client = getSupabaseClient();
		const totalBytes = await drivePdfReferenceSize(detail.id);
		if (totalBytes !== null) {
			const opened = await openDrivePdfRangeDocument({ client, fileId, totalBytes });
			try {
				return await renderPdfDocumentPage(opened.document, pageNumber);
			} finally {
				await opened.destroy();
			}
		}

		const blob = await downloadBrowserDriveFile({ client, fileId, maximumBytes: 64 * 1024 * 1024 });
		const file = new File([blob], detail.originalFilename, { type: 'application/pdf' });
		return renderPdfPage(file, pageNumber);
	}

	async function refreshMedia(expectedGeneration: number) {
		loading = true;
		renderError = null;
		renderedUrl = null;
		releaseObjectUrl();
		try {
			if (detail.originalReference.provider === 'missing') return;

			if (detail.kind === 'image') {
				if (detail.originalReference.provider === 'supabase') {
					renderedUrl = detail.originalReference.url;
					return;
				}
				const blob = await downloadBrowserDriveFile({
					client: getSupabaseClient(),
					fileId: detail.originalReference.driveFileId,
					maximumBytes: 64 * 1024 * 1024
				});
				if (expectedGeneration !== generation) return;
				publishBlob(blob);
				return;
			}

			const rendered =
				detail.originalReference.provider === 'supabase'
					? await renderSupabasePdf(detail.originalReference.url, page.pageNumber)
					: await renderDrivePdf(detail.originalReference.driveFileId, page.pageNumber);
			if (expectedGeneration !== generation) return;
			publishBlob(rendered);
		} catch {
			if (expectedGeneration !== generation) return;
			renderError = 'Não foi possível renderizar esta página para marcação espacial.';
		} finally {
			if (expectedGeneration === generation) loading = false;
		}
	}

	$effect(() => {
		detail.id;
		detail.originalReference.provider;
		detail.originalReference.url;
		page.id;
		page.pageNumber;
		generation += 1;
		void refreshMedia(generation);
	});

	onDestroy(() => {
		generation += 1;
		releaseObjectUrl();
	});
</script>

<div class="media-viewer">
	{#if loading}
		<p class="status" role="status">Preparando a página para localizar a correspondência…</p>
	{:else if detail.originalReference.provider === 'missing'}
		<p class="status" role="status">O original não está disponível.</p>
	{:else if renderedUrl}
		<div class="page-image">
			<img src={renderedUrl} alt={`Página ${page.pageNumber} do original de ${detail.title}`} />
			{#if query && page.wordGeometry.length > 0}
				<WordGeometryOverlay geometry={page.wordGeometry} {query} />
			{/if}
		</div>
	{:else}
		<div class="status" role="status">
			<p>{renderError ?? 'O original não pôde ser exibido aqui.'}</p>
			{#if detail.originalReference.provider === 'google_drive'}
				<a href={detail.originalReference.url} target="_blank" rel="noreferrer">Abrir no Google Drive</a>
			{:else}
				<a href={detail.originalReference.url} target="_blank" rel="noreferrer">Abrir original</a>
			{/if}
		</div>
	{/if}

	{#if query}
		<div class="text-fallback">
			<SearchMatch
				text={page.text}
				{query}
				label={page.wordGeometry.length > 0 ? 'Trecho correspondente' : 'Encontrado nesta mídia'}
				maximumLength={220}
				compact
			/>
		</div>
	{/if}
</div>

<style>
	.media-viewer {
		display: grid;
		gap: 0.7rem;
		min-height: 28rem;
		align-content: start;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #d8d6d0;
	}

	.page-image {
		position: relative;
		width: 100%;
		margin: auto;
		background: white;
	}

	.page-image img {
		display: block;
		width: 100%;
		height: auto;
	}

	.status {
		min-height: 26rem;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 0.6rem;
		margin: 0;
		padding: 1.25rem;
		color: var(--muted);
		text-align: center;
	}

	.status p {
		margin: 0;
	}

	.status a {
		color: var(--archive);
		font-weight: 720;
	}

	.text-fallback {
		position: sticky;
		bottom: 0.7rem;
		z-index: 3;
		margin: -0.1rem 0.7rem 0.7rem;
	}
</style>
