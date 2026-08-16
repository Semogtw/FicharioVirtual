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
	import {
		loadDocumentPage,
		type DocumentDetail,
		type DocumentPageSummary
	} from '$lib/services/document-detail';
	import { getSupabaseClient } from '$lib/services/supabase';

	interface DocumentMediaViewerProps {
		detail: DocumentDetail;
		pages: readonly DocumentPageSummary[];
		query: string;
		focusPageNumber?: number;
	}

	type RenderedPage = {
		page: DocumentPageSummary;
		detail: PageDetail | null;
		url: string | null;
		nativeGeometry: readonly WordGeometry[];
		error: string | null;
		loading: boolean;
	};

	const MAX_BROWSER_DRIVE_PDF_BYTES = 64 * 1024 * 1024;
	const MAX_BROWSER_DRIVE_IMAGE_BYTES = 64 * 1024 * 1024;
	const EMPTY_GEOMETRY = Object.freeze([]) as readonly WordGeometry[];

	let { detail, pages, query, focusPageNumber }: DocumentMediaViewerProps = $props();
	let renderedPages = $state<RenderedPage[]>([]);
	let requestedPageNumbers = $state<readonly number[]>([]);
	let processing = false;
	let generation = 0;
	let supabasePdfFile: File | null = null;
	let drivePdfFile: File | null = null;
	let drivePdfSize: number | null | undefined = undefined;
	const ownedObjectUrls = new Map<string, string>();
	let mediaRevision = $derived.by(() => {
		const reference = detail.originalReference;
		return JSON.stringify([
			detail.id,
			detail.kind,
			detail.originalFilename,
			reference.provider,
			reference.url,
			reference.driveFileId,
			pages.map((page) => [page.id, page.pageNumber, page.updatedAt])
		]);
	});

	function releaseObjectUrls() {
		for (const url of ownedObjectUrls.values()) URL.revokeObjectURL(url);
		ownedObjectUrls.clear();
	}

	function resetMediaCaches() {
		releaseObjectUrls();
		supabasePdfFile = null;
		drivePdfFile = null;
		drivePdfSize = undefined;
	}

	function resetRenderedPages() {
		resetMediaCaches();
		renderedPages = pages.map((page) => ({
			page,
			detail: null,
			url: null,
			nativeGeometry: EMPTY_GEOMETRY,
			error: null,
			loading: false
		}));
		requestedPageNumbers = [];
	}

	function refreshIsStale(expectedGeneration: number, expectedRevision: string) {
		return expectedGeneration !== generation || expectedRevision !== mediaRevision;
	}

	function renderedIndex(pageNumber: number) {
		return renderedPages.findIndex((rendered) => rendered.page.pageNumber === pageNumber);
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
		return rendered.detail?.wordGeometry.length
			? rendered.detail.wordGeometry
			: rendered.nativeGeometry;
	}

	function updateRendered(pageNumber: number, changes: Partial<RenderedPage>) {
		const index = renderedIndex(pageNumber);
		const current = renderedPages[index];
		if (index < 0 || !current) return;
		renderedPages[index] = { ...current, ...changes };
	}

	function publishPage(
		page: PageDetail,
		blob: Blob,
		geometry: readonly WordGeometry[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (refreshIsStale(expectedGeneration, expectedRevision)) return;
		const existingUrl = ownedObjectUrls.get(page.id);
		if (existingUrl) URL.revokeObjectURL(existingUrl);
		const url = URL.createObjectURL(blob);
		ownedObjectUrls.set(page.id, url);
		updateRendered(page.pageNumber, {
			detail: page,
			url,
			nativeGeometry: geometry,
			error: null,
			loading: false
		});
	}

	function publishRemotePage(
		page: PageDetail,
		url: string,
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (refreshIsStale(expectedGeneration, expectedRevision)) return;
		updateRendered(page.pageNumber, {
			detail: page,
			url,
			nativeGeometry: EMPTY_GEOMETRY,
			error: null,
			loading: false
		});
	}

	function failPage(pageNumber: number, message: string) {
		updateRendered(pageNumber, { error: message, loading: false });
	}

	function requestPage(pageNumber: number) {
		const index = renderedIndex(pageNumber);
		const rendered = renderedPages[index];
		if (!rendered || rendered.url || rendered.error || rendered.loading) return;
		if (requestedPageNumbers.includes(pageNumber)) return;
		requestedPageNumbers = Object.freeze([...requestedPageNumbers, pageNumber]);
	}

	function requestFocusWindow() {
		const focus = focusPageNumber ?? pages[0]?.pageNumber;
		if (!focus) return;
		requestPage(focus);
		requestPage(focus - 1);
		requestPage(focus + 1);
	}

	async function drivePdfReferenceSize(documentId: string) {
		if (drivePdfSize !== undefined) return drivePdfSize;
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
			drivePdfSize = null;
			return null;
		}
		drivePdfSize = data.source_size_bytes;
		return drivePdfSize;
	}

	async function ensureSupabasePdfFile() {
		if (supabasePdfFile) return supabasePdfFile;
		if (detail.originalReference.provider !== 'supabase') throw new Error('PDF indisponível');
		const response = await fetch(detail.originalReference.url, { cache: 'no-store' });
		if (!response.ok) throw new Error('PDF indisponível');
		const blob = await response.blob();
		if (blob.size < 1 || blob.size > 256 * 1024 * 1024) throw new Error('PDF inválido');
		supabasePdfFile = new File([blob], detail.originalFilename, { type: 'application/pdf' });
		return supabasePdfFile;
	}

	async function ensureDownloadedDrivePdf(fileId: string) {
		if (drivePdfFile) return drivePdfFile;
		const blob = await downloadBrowserDriveFile({
			client: getSupabaseClient(),
			fileId,
			maximumBytes: MAX_BROWSER_DRIVE_PDF_BYTES
		});
		drivePdfFile = new File([blob], detail.originalFilename, { type: 'application/pdf' });
		return drivePdfFile;
	}

	async function renderPdfFileTargets(
		file: File,
		targets: readonly PageDetail[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		for (const page of targets) {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			try {
				const blob = await renderPdfPage(file, page.pageNumber);
				const geometry = shouldExtractNativeGeometry(page)
					? await extractPdfFileWordGeometry(file, page.pageNumber)
					: EMPTY_GEOMETRY;
				publishPage(page, blob, geometry, expectedGeneration, expectedRevision);
			} catch {
				if (refreshIsStale(expectedGeneration, expectedRevision)) return;
				failPage(page.pageNumber, `Não foi possível renderizar a página ${page.pageNumber}.`);
			}
		}
	}

	async function renderPdfDocumentTargets(
		pdfDocument: PDFDocumentProxy,
		targets: readonly PageDetail[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		for (const page of targets) {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			try {
				const blob = await renderPdfDocumentPage(pdfDocument, page.pageNumber);
				const geometry = shouldExtractNativeGeometry(page)
					? await extractPdfDocumentWordGeometry(pdfDocument, page.pageNumber)
					: EMPTY_GEOMETRY;
				publishPage(page, blob, geometry, expectedGeneration, expectedRevision);
			} catch {
				if (refreshIsStale(expectedGeneration, expectedRevision)) return;
				failPage(page.pageNumber, `Não foi possível renderizar a página ${page.pageNumber}.`);
			}
		}
	}

	async function renderDrivePdfTargets(
		fileId: string,
		targets: readonly PageDetail[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		const totalBytes = await drivePdfReferenceSize(detail.id);
		if (totalBytes !== null) {
			let opened: Awaited<ReturnType<typeof openDrivePdfRangeDocument>> | null = null;
			try {
				opened = await openDrivePdfRangeDocument({
					client: getSupabaseClient(),
					fileId,
					totalBytes
				});
				await renderPdfDocumentTargets(
					opened.document,
					targets,
					expectedGeneration,
					expectedRevision
				);
				return;
			} catch (error) {
				if (totalBytes > MAX_BROWSER_DRIVE_PDF_BYTES) throw error;
			} finally {
				await opened?.destroy();
			}
		}

		const file = await ensureDownloadedDrivePdf(fileId);
		await renderPdfFileTargets(file, targets, expectedGeneration, expectedRevision);
	}

	async function renderImageTarget(
		page: PageDetail,
		expectedGeneration: number,
		expectedRevision: string
	) {
		try {
			if (page.sourceDriveFileId) {
				const blob = await downloadBrowserDriveFile({
					client: getSupabaseClient(),
					fileId: page.sourceDriveFileId,
					maximumBytes: MAX_BROWSER_DRIVE_IMAGE_BYTES
				});
				publishPage(page, blob, EMPTY_GEOMETRY, expectedGeneration, expectedRevision);
				return;
			}
			if (page.pageNumber === 1 && detail.originalReference.provider === 'supabase') {
				publishRemotePage(
					page,
					detail.originalReference.url,
					expectedGeneration,
					expectedRevision
				);
				return;
			}
			if (page.pageNumber === 1 && detail.originalReference.provider === 'google_drive') {
				const blob = await downloadBrowserDriveFile({
					client: getSupabaseClient(),
					fileId: detail.originalReference.driveFileId,
					maximumBytes: MAX_BROWSER_DRIVE_IMAGE_BYTES
				});
				publishPage(page, blob, EMPTY_GEOMETRY, expectedGeneration, expectedRevision);
				return;
			}
			failPage(page.pageNumber, `O original da página ${page.pageNumber} não está disponível.`);
		} catch {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			failPage(page.pageNumber, `Não foi possível preparar a página ${page.pageNumber}.`);
		}
	}

	async function loadRequestedDetails(
		pageNumbers: readonly number[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		const loaded = await Promise.all(
			pageNumbers.map(async (pageNumber) => {
				updateRendered(pageNumber, { loading: true, error: null });
				try {
					return await loadDocumentPage(detail.id, pageNumber);
				} catch {
					if (!refreshIsStale(expectedGeneration, expectedRevision)) {
						failPage(pageNumber, `Não foi possível carregar a página ${pageNumber}.`);
					}
					return null;
				}
			})
		);
		return loaded.filter((page): page is PageDetail => page !== null);
	}

	async function processBatch(
		pageNumbers: readonly number[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		const targets = await loadRequestedDetails(pageNumbers, expectedGeneration, expectedRevision);
		if (targets.length === 0 || refreshIsStale(expectedGeneration, expectedRevision)) return;
		if (detail.kind === 'image') {
			for (const page of targets) {
				await renderImageTarget(page, expectedGeneration, expectedRevision);
			}
			return;
		}
		if (detail.originalReference.provider === 'missing') {
			for (const page of targets) failPage(page.pageNumber, 'O original não está disponível.');
			return;
		}
		try {
			if (detail.originalReference.provider === 'supabase') {
				const file = await ensureSupabasePdfFile();
				await renderPdfFileTargets(file, targets, expectedGeneration, expectedRevision);
				return;
			}
			await renderDrivePdfTargets(
				detail.originalReference.driveFileId,
				targets,
				expectedGeneration,
				expectedRevision
			);
		} catch {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			for (const page of targets) {
				failPage(page.pageNumber, 'Não foi possível preparar o original para visualização.');
			}
		}
	}

	async function drainQueue(expectedGeneration: number, expectedRevision: string) {
		if (processing) return;
		processing = true;
		try {
			while (!refreshIsStale(expectedGeneration, expectedRevision)) {
				const batch = requestedPageNumbers;
				if (batch.length === 0) break;
				requestedPageNumbers = [];
				await processBatch(batch, expectedGeneration, expectedRevision);
			}
		} finally {
			processing = false;
			if (
				requestedPageNumbers.length > 0 &&
				!refreshIsStale(expectedGeneration, expectedRevision)
			) {
				void drainQueue(expectedGeneration, expectedRevision);
			}
		}
	}

	function observePage(node: HTMLElement, page: DocumentPageSummary) {
		let currentPage = page;
		if (typeof IntersectionObserver === 'undefined') {
			requestPage(currentPage.pageNumber);
			return {
				update(nextPage: DocumentPageSummary) {
					currentPage = nextPage;
					requestPage(currentPage.pageNumber);
				},
				destroy() {}
			};
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) requestPage(currentPage.pageNumber);
			},
			{ rootMargin: '900px 0px' }
		);
		observer.observe(node);
		return {
			update(nextPage: DocumentPageSummary) {
				currentPage = nextPage;
			},
			destroy() {
				observer.disconnect();
			}
		};
	}

	$effect(() => {
		const expectedRevision = mediaRevision;
		generation += 1;
		const expectedGeneration = generation;
		untrack(() => {
			resetRenderedPages();
			requestFocusWindow();
			if (requestedPageNumbers.length > 0) {
				void drainQueue(expectedGeneration, expectedRevision);
			}
		});
	});

	$effect(() => {
		const queued = requestedPageNumbers.length;
		const expectedGeneration = generation;
		const expectedRevision = mediaRevision;
		if (queued > 0) untrack(() => void drainQueue(expectedGeneration, expectedRevision));
	});

	$effect(() => {
		focusPageNumber;
		pages;
		untrack(requestFocusWindow);
	});

	onDestroy(() => {
		generation += 1;
		resetMediaCaches();
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
					use:observePage={rendered.page}
				>
					{#if rendered.url}
						<div class="page-image">
							<img
								src={rendered.url}
								alt={`Página ${rendered.page.pageNumber} do original de ${detail.title}`}
								decoding="async"
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

	.document-pages,
	.image-pages {
		display: grid;
		gap: 2px;
		padding: 2px;
	}

	.document-page {
		position: relative;
		min-height: 28rem;
		scroll-margin-top: 1rem;
		background: white;
		content-visibility: auto;
		contain-intrinsic-size: auto 42rem;
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

	.page-status,
	.status {
		min-height: 28rem;
		display: grid;
		place-items: center;
		margin: 0;
		padding: 1rem;
		color: var(--muted);
		text-align: center;
	}

	.page-status.error {
		color: var(--danger);
	}
</style>
