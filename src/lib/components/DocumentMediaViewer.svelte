<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { PDFDocumentProxy } from 'pdfjs-dist';
	import WordGeometryOverlay from '$lib/components/WordGeometryOverlay.svelte';
	import { downloadBrowserDriveFile } from '$lib/drive/browser-download';
	import type { PageDetail } from '$lib/domain/page';
	import type { WordGeometry } from '$lib/ocr/word-geometry';
	import { openDrivePdfRangeDocument } from '$lib/pdf/drive-range-transport';
	import { renderPdfDocumentPage, renderPdfPage } from '$lib/pdf/renderer';
	import {
		extractPdfDocumentWordGeometry,
		extractPdfFileWordGeometry
	} from '$lib/pdf/text-geometry';
	import type { DocumentDetail } from '$lib/services/document-detail';
	import { getSupabaseClient } from '$lib/services/supabase';

	interface DocumentMediaViewerProps {
		detail: DocumentDetail;
		pages: readonly PageDetail[];
		query: string;
	}

	type RenderedPage = {
		page: PageDetail;
		url: string | null;
		nativeGeometry: readonly WordGeometry[];
		error: string | null;
	};

	const MAX_BROWSER_DRIVE_PDF_BYTES = 64 * 1024 * 1024;
	const MAX_BROWSER_DRIVE_IMAGE_BYTES = 64 * 1024 * 1024;
	const EMPTY_GEOMETRY = Object.freeze([]) as readonly WordGeometry[];

	let { detail, pages, query }: DocumentMediaViewerProps = $props();
	let renderedPages = $state<RenderedPage[]>([]);
	let generation = 0;
	const ownedObjectUrls = new Set<string>();
	let mediaRevision = $derived.by(() => {
		const reference = detail.originalReference;
		return JSON.stringify([
			detail.id,
			detail.kind,
			detail.originalFilename,
			reference.provider,
			reference.url,
			reference.driveFileId,
			pages.map((page) => [
				page.id,
				page.pageNumber,
				page.sourceDriveFileId,
				page.wordGeometry.length,
				shouldExtractNativeGeometry(page)
			])
		]);
	});

	function releaseObjectUrls() {
		for (const url of ownedObjectUrls) URL.revokeObjectURL(url);
		ownedObjectUrls.clear();
	}

	function resetRenderedPages() {
		releaseObjectUrls();
		renderedPages = pages.map((page) => ({
			page,
			url: null,
			nativeGeometry: EMPTY_GEOMETRY,
			error: null
		}));
	}

	function refreshIsStale(expectedGeneration: number, expectedRevision: string) {
		return expectedGeneration !== generation || expectedRevision !== mediaRevision;
	}

	function shouldExtractNativeGeometry(page: PageDetail) {
		return (
			detail.kind === 'pdf' &&
			query.trim().length > 0 &&
			page.wordGeometry.length === 0 &&
			typeof page.nativeText === 'string' &&
			page.nativeText.trim().length > 0
		);
	}

	function effectiveGeometry(rendered: RenderedPage) {
		return rendered.page.wordGeometry.length > 0
			? rendered.page.wordGeometry
			: rendered.nativeGeometry;
	}

	function publishPage(
		index: number,
		blob: Blob,
		geometry: readonly WordGeometry[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (refreshIsStale(expectedGeneration, expectedRevision)) return;
		const current = renderedPages[index];
		if (!current) return;
		const url = URL.createObjectURL(blob);
		ownedObjectUrls.add(url);
		renderedPages[index] = {
			...current,
			url,
			nativeGeometry: geometry,
			error: null
		};
	}

	function publishRemotePage(
		index: number,
		url: string,
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (refreshIsStale(expectedGeneration, expectedRevision)) return;
		const current = renderedPages[index];
		if (!current) return;
		renderedPages[index] = { ...current, url, error: null };
	}

	function failPage(index: number, message: string) {
		const current = renderedPages[index];
		if (!current) return;
		renderedPages[index] = { ...current, error: message };
	}

	function failPendingPages(message: string) {
		for (let index = 0; index < renderedPages.length; index += 1) {
			if (!renderedPages[index]?.url) failPage(index, message);
		}
	}

	async function renderPdfFilePages(
		file: File,
		expectedGeneration: number,
		expectedRevision: string
	) {
		for (let index = 0; index < pages.length; index += 1) {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			const page = pages[index];
			if (!page) continue;
			try {
				const blob = await renderPdfPage(file, page.pageNumber);
				const geometry = shouldExtractNativeGeometry(page)
					? await extractPdfFileWordGeometry(file, page.pageNumber)
					: EMPTY_GEOMETRY;
				publishPage(index, blob, geometry, expectedGeneration, expectedRevision);
			} catch {
				if (refreshIsStale(expectedGeneration, expectedRevision)) return;
				failPage(index, `Não foi possível renderizar a página ${page.pageNumber}.`);
			}
		}
	}

	async function renderPdfDocumentPages(
		pdfDocument: PDFDocumentProxy,
		expectedGeneration: number,
		expectedRevision: string
	) {
		for (let index = 0; index < pages.length; index += 1) {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			const page = pages[index];
			if (!page) continue;
			const blob = await renderPdfDocumentPage(pdfDocument, page.pageNumber);
			const geometry = shouldExtractNativeGeometry(page)
				? await extractPdfDocumentWordGeometry(pdfDocument, page.pageNumber)
				: EMPTY_GEOMETRY;
			publishPage(index, blob, geometry, expectedGeneration, expectedRevision);
		}
	}

	async function renderSupabasePdf(
		sourceUrl: string,
		expectedGeneration: number,
		expectedRevision: string
	) {
		const response = await fetch(sourceUrl, { cache: 'no-store' });
		if (!response.ok) throw new Error('PDF indisponível');
		const blob = await response.blob();
		if (blob.size < 1 || blob.size > 256 * 1024 * 1024) throw new Error('PDF inválido');
		const file = new File([blob], detail.originalFilename, { type: 'application/pdf' });
		await renderPdfFilePages(file, expectedGeneration, expectedRevision);
	}

	async function drivePdfReferenceSize(documentId: string) {
		const { data, error } = await getSupabaseClient()
			.from('drive_pdf_reference_imports')
			.select('source_size_bytes')
			.eq('document_id', documentId)
			.maybeSingle();
		if (
			error ||
			!data ||
			!Number.isSafeInteger(data.source_size_bytes) ||
			data.source_size_bytes < 1
		) {
			return null;
		}
		return data.source_size_bytes;
	}

	async function renderDownloadedDrivePdf(
		fileId: string,
		expectedGeneration: number,
		expectedRevision: string
	) {
		const blob = await downloadBrowserDriveFile({
			client: getSupabaseClient(),
			fileId,
			maximumBytes: MAX_BROWSER_DRIVE_PDF_BYTES
		});
		const file = new File([blob], detail.originalFilename, { type: 'application/pdf' });
		await renderPdfFilePages(file, expectedGeneration, expectedRevision);
	}

	async function renderDrivePdf(
		fileId: string,
		expectedGeneration: number,
		expectedRevision: string
	) {
		const client = getSupabaseClient();
		const totalBytes = await drivePdfReferenceSize(detail.id);
		if (totalBytes !== null) {
			let opened: Awaited<ReturnType<typeof openDrivePdfRangeDocument>> | null = null;
			try {
				opened = await openDrivePdfRangeDocument({ client, fileId, totalBytes });
				await renderPdfDocumentPages(opened.document, expectedGeneration, expectedRevision);
				return;
			} catch (error) {
				if (totalBytes > MAX_BROWSER_DRIVE_PDF_BYTES) throw error;
				if (!refreshIsStale(expectedGeneration, expectedRevision)) resetRenderedPages();
			} finally {
				await opened?.destroy();
			}
		}

		await renderDownloadedDrivePdf(fileId, expectedGeneration, expectedRevision);
	}

	async function renderImagePages(expectedGeneration: number, expectedRevision: string) {
		const client = getSupabaseClient();
		for (let index = 0; index < pages.length; index += 1) {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			const page = pages[index];
			if (!page) continue;
			try {
				if (page.sourceDriveFileId) {
					const blob = await downloadBrowserDriveFile({
						client,
						fileId: page.sourceDriveFileId,
						maximumBytes: MAX_BROWSER_DRIVE_IMAGE_BYTES
					});
					publishPage(index, blob, EMPTY_GEOMETRY, expectedGeneration, expectedRevision);
					continue;
				}
				if (index === 0 && detail.originalReference.provider === 'supabase') {
					publishRemotePage(
						index,
						detail.originalReference.url,
						expectedGeneration,
						expectedRevision
					);
					continue;
				}
				if (index === 0 && detail.originalReference.provider === 'google_drive') {
					const blob = await downloadBrowserDriveFile({
						client,
						fileId: detail.originalReference.driveFileId,
						maximumBytes: MAX_BROWSER_DRIVE_IMAGE_BYTES
					});
					publishPage(index, blob, EMPTY_GEOMETRY, expectedGeneration, expectedRevision);
					continue;
				}
				failPage(index, `O original da página ${page.pageNumber} não está disponível.`);
			} catch {
				if (refreshIsStale(expectedGeneration, expectedRevision)) return;
				failPage(index, `Não foi possível preparar a página ${page.pageNumber}.`);
			}
		}
	}

	async function refreshMedia(expectedGeneration: number, expectedRevision: string) {
		resetRenderedPages();
		if (pages.length === 0) return;
		try {
			if (detail.kind === 'image') {
				await renderImagePages(expectedGeneration, expectedRevision);
				return;
			}

			if (detail.originalReference.provider === 'missing') return;
			if (detail.originalReference.provider === 'supabase') {
				await renderSupabasePdf(detail.originalReference.url, expectedGeneration, expectedRevision);
			} else {
				await renderDrivePdf(
					detail.originalReference.driveFileId,
					expectedGeneration,
					expectedRevision
				);
			}
		} catch {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			failPendingPages('Não foi possível preparar o original para visualização.');
		}
	}

	$effect(() => {
		const expectedRevision = mediaRevision;
		generation += 1;
		untrack(() => void refreshMedia(generation, expectedRevision));
	});

	onDestroy(() => {
		generation += 1;
		releaseObjectUrls();
	});
</script>

<div class="media-viewer">
	{#if detail.originalReference.provider === 'missing' && detail.kind !== 'image'}
		<p class="status" role="status">O original não está disponível.</p>
	{:else if renderedPages.length === 0}
		<p class="status" role="status">Este documento ainda não tem páginas disponíveis.</p>
	{:else}
		<div class:document-pages={detail.kind === 'pdf'} class:image-pages={detail.kind === 'image'}>
			{#each renderedPages as rendered (rendered.page.id)}
				<article
					class="document-page"
					id={`document-page-${rendered.page.pageNumber}`}
					aria-label={`Página ${rendered.page.pageNumber}`}
				>
					{#if rendered.url}
						<div class="page-image">
							<img
								src={rendered.url}
								alt={`Página ${rendered.page.pageNumber} do original de ${detail.title}`}
							/>
							{#if query && effectiveGeometry(rendered).length > 0}
								<WordGeometryOverlay geometry={effectiveGeometry(rendered)} {query} />
							{/if}
						</div>
					{:else if rendered.error}
						<p class="page-status error" role="status">{rendered.error}</p>
					{:else}
						<p class="page-status" role="status">
							Preparando página {rendered.page.pageNumber}…
						</p>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>

<style>
	.media-viewer {
		display: grid;
		align-content: start;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #d8d6d0;
	}

	.document-pages {
		display: grid;
		gap: 2px;
		padding: 2px;
	}

	.image-pages {
		display: grid;
		gap: 2px;
		padding: 2px;
	}

	.document-page {
		position: relative;
		scroll-margin-top: 1rem;
		background: white;
	}

	.page-image {
		position: relative;
		width: 100%;
		background: white;
	}

	.page-image img {
		display: block;
		width: 100%;
		height: auto;
	}

	.page-status {
		min-height: 28rem;
		display: grid;
		place-items: center;
		margin: 0;
		padding: 1.25rem;
		background: white;
		color: var(--muted);
		text-align: center;
	}

	.page-status.error {
		color: var(--danger);
	}

	.status {
		min-height: 26rem;
		display: grid;
		place-items: center;
		margin: 0;
		padding: 1.25rem;
		color: var(--muted);
		text-align: center;
	}

	@media (max-width: 620px) {
		.document-pages,
		.image-pages {
			gap: 1px;
			padding: 1px;
		}

		.page-status,
		.status {
			min-height: 20rem;
		}
	}
</style>
