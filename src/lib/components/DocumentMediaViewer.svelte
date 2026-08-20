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
	import { createLocalImagePreview } from '$lib/pwa/image-preview';
	import {
		readLocalMediaPreview,
		writeLocalMediaPreview,
		type MediaPreviewCacheKey
	} from '$lib/pwa/media-preview-cache';
	import {
		loadDocumentPage,
		type DocumentDetail,
		type DocumentPageSummary
	} from '$lib/services/document-detail';
	import { getSupabaseClient } from '$lib/services/supabase';
	import { sessionState } from '$lib/stores/session.svelte';

	interface DocumentMediaViewerProps {
		detail: DocumentDetail;
		pages: readonly DocumentPageSummary[];
		query: string;
		focusPageNumber?: number;
		initialPageDetail?: PageDetail;
	}

	type RenderedPage = {
		page: DocumentPageSummary;
		detail: PageDetail | null;
		url: string | null;
		nativeGeometry: readonly WordGeometry[];
		error: string | null;
		loading: boolean;
		metadataLoading: boolean;
	};

	type CacheablePage = Readonly<{
		id: string;
		pageNumber: number;
		sourceDriveFileId: string | null;
	}>;

	const MAX_BROWSER_DRIVE_PDF_BYTES = 64 * 1024 * 1024;
	const MAX_BROWSER_DRIVE_IMAGE_BYTES = 64 * 1024 * 1024;
	const EMPTY_GEOMETRY = Object.freeze([]) as readonly WordGeometry[];

	let { detail, pages, query, focusPageNumber, initialPageDetail }: DocumentMediaViewerProps =
		$props();
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
			pages.map((page) => [page.id, page.pageNumber, page.sourceDriveFileId, page.updatedAt])
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
		const directImageUrl =
			detail.kind === 'image' && detail.originalReference.provider === 'supabase'
				? detail.originalReference.url
				: null;
		renderedPages = pages.map((page) => ({
			page,
			detail: initialPageDetail?.pageNumber === page.pageNumber ? initialPageDetail : null,
			url: page.pageNumber === 1 ? directImageUrl : null,
			nativeGeometry: EMPTY_GEOMETRY,
			error: null,
			loading: false,
			metadataLoading: false
		}));
		requestedPageNumbers = [];
	}

	function refreshIsStale(expectedGeneration: number, expectedRevision: string) {
		return expectedGeneration !== generation || expectedRevision !== mediaRevision;
	}

	function renderedIndex(pageNumber: number) {
		return renderedPages.findIndex((rendered) => rendered.page.pageNumber === pageNumber);
	}

	function localPreviewKey(page: CacheablePage): MediaPreviewCacheKey | null {
		const ownerId = sessionState.user?.id;
		if (!ownerId) return null;
		const sourceId =
			page.sourceDriveFileId ??
			detail.originalReference.driveFileId ??
			(detail.originalReference.provider === 'supabase' ? `supabase:${detail.id}` : null);
		if (!sourceId) return null;
		return Object.freeze({
			ownerId,
			documentId: detail.id,
			pageId: page.id,
			sourceId,
			kind: detail.kind === 'pdf' ? ('pdf-page' as const) : ('image' as const)
		});
	}

	async function readCachedPreview(page: CacheablePage) {
		const key = localPreviewKey(page);
		return key ? await readLocalMediaPreview(key) : null;
	}

	function cachePdfPreview(page: PageDetail, blob: Blob) {
		const key = localPreviewKey(page);
		if (key) void writeLocalMediaPreview(key, blob);
	}

	async function cacheImagePreview(page: DocumentPageSummary, blob: Blob) {
		const key = localPreviewKey(page);
		if (!key) return;
		const preview = await createLocalImagePreview(blob);
		if (preview) await writeLocalMediaPreview(key, preview);
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

	function publishImagePage(
		page: DocumentPageSummary,
		blob: Blob,
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (refreshIsStale(expectedGeneration, expectedRevision)) return;
		const existingUrl = ownedObjectUrls.get(page.id);
		if (existingUrl) URL.revokeObjectURL(existingUrl);
		const url = URL.createObjectURL(blob);
		ownedObjectUrls.set(page.id, url);
		updateRendered(page.pageNumber, {
			url,
			nativeGeometry: EMPTY_GEOMETRY,
			error: null,
			loading: false
		});
	}

	function publishRemoteImagePage(
		page: DocumentPageSummary,
		url: string,
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (refreshIsStale(expectedGeneration, expectedRevision)) return;
		updateRendered(page.pageNumber, {
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
		if (!rendered || rendered.error) return;
		if (detail.kind === 'image') {
			const needsMedia = rendered.url === null && !rendered.loading;
			const needsMetadata =
				query.trim().length > 0 && rendered.detail === null && !rendered.metadataLoading;
			if (!needsMedia && !needsMetadata) return;
		} else if (rendered.url || rendered.loading) {
			return;
		}
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
				cachePdfPreview(page, blob);
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
				cachePdfPreview(page, blob);
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
		page: DocumentPageSummary,
		expectedGeneration: number,
		expectedRevision: string
	) {
		try {
			const cached = await readCachedPreview(page);
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			if (cached) {
				publishImagePage(page, cached, expectedGeneration, expectedRevision);
				return;
			}
			const pageDriveFileId =
				page.sourceDriveFileId ??
				(page.pageNumber === 1 ? detail.originalReference.driveFileId : null);
			if (pageDriveFileId) {
				const blob = await downloadBrowserDriveFile({
					client: getSupabaseClient(),
					fileId: pageDriveFileId,
					maximumBytes: MAX_BROWSER_DRIVE_IMAGE_BYTES
				});
				publishImagePage(page, blob, expectedGeneration, expectedRevision);
				void cacheImagePreview(page, blob);
				return;
			}
			if (page.pageNumber === 1 && detail.originalReference.provider === 'supabase') {
				publishRemoteImagePage(
					page,
					detail.originalReference.url,
					expectedGeneration,
					expectedRevision
				);
				return;
			}
			failPage(page.pageNumber, `O original da página ${page.pageNumber} não está disponível.`);
		} catch {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			failPage(page.pageNumber, `Não foi possível preparar a página ${page.pageNumber}.`);
		}
	}

	async function hydrateImageMetadata(
		pageNumbers: readonly number[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (query.trim().length === 0) return;
		await Promise.allSettled(
			pageNumbers.map(async (pageNumber) => {
				const rendered = renderedPages[renderedIndex(pageNumber)];
				if (!rendered || rendered.detail || rendered.metadataLoading) return;
				updateRendered(pageNumber, { metadataLoading: true });
				try {
					const page =
						initialPageDetail?.pageNumber === pageNumber
							? initialPageDetail
							: await loadDocumentPage(detail.id, pageNumber);
					if (!refreshIsStale(expectedGeneration, expectedRevision)) {
						updateRendered(pageNumber, { detail: page, metadataLoading: false });
					}
				} catch {
					if (!refreshIsStale(expectedGeneration, expectedRevision)) {
						updateRendered(pageNumber, { metadataLoading: false });
					}
				}
			})
		);
	}

	async function loadRequestedDetails(
		pageNumbers: readonly number[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		const loaded = await Promise.all(
			pageNumbers.map(async (pageNumber) => {
				updateRendered(pageNumber, { loading: true, error: null });
				if (initialPageDetail?.pageNumber === pageNumber) return initialPageDetail;
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

	async function publishCachedPdfSummaries(
		pageNumbers: readonly number[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (query.trim().length > 0) return pageNumbers;
		const misses: number[] = [];
		for (const pageNumber of pageNumbers) {
			const page = pages.find((candidate) => candidate.pageNumber === pageNumber);
			if (!page) continue;
			updateRendered(pageNumber, { loading: true, error: null });
			const cached = await readCachedPreview(page);
			if (refreshIsStale(expectedGeneration, expectedRevision)) return [];
			if (cached) publishImagePage(page, cached, expectedGeneration, expectedRevision);
			else misses.push(pageNumber);
		}
		return Object.freeze(misses);
	}

	async function publishCachedPdfDetails(
		targets: readonly PageDetail[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		const misses: PageDetail[] = [];
		for (const page of targets) {
			if (shouldExtractNativeGeometry(page)) {
				misses.push(page);
				continue;
			}
			const cached = await readCachedPreview(page);
			if (refreshIsStale(expectedGeneration, expectedRevision)) return [];
			if (cached) publishPage(page, cached, EMPTY_GEOMETRY, expectedGeneration, expectedRevision);
			else misses.push(page);
		}
		return Object.freeze(misses);
	}

	async function processImageBatch(
		pageNumbers: readonly number[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		const targets = pageNumbers
			.map((pageNumber) => pages.find((page) => page.pageNumber === pageNumber) ?? null)
			.filter((page): page is DocumentPageSummary => page !== null);
		for (const page of targets) {
			const rendered = renderedPages[renderedIndex(page.pageNumber)];
			if (!rendered?.url && !rendered?.loading) {
				updateRendered(page.pageNumber, { loading: true, error: null });
				void renderImageTarget(page, expectedGeneration, expectedRevision);
			}
		}
		void hydrateImageMetadata(pageNumbers, expectedGeneration, expectedRevision);
	}

	async function processBatch(
		pageNumbers: readonly number[],
		expectedGeneration: number,
		expectedRevision: string
	) {
		if (detail.kind === 'image') {
			await processImageBatch(pageNumbers, expectedGeneration, expectedRevision);
			return;
		}

		const uncachedPageNumbers = await publishCachedPdfSummaries(
			pageNumbers,
			expectedGeneration,
			expectedRevision
		);
		if (uncachedPageNumbers.length === 0 || refreshIsStale(expectedGeneration, expectedRevision)) {
			return;
		}
		const targets = await loadRequestedDetails(
			uncachedPageNumbers,
			expectedGeneration,
			expectedRevision
		);
		if (targets.length === 0 || refreshIsStale(expectedGeneration, expectedRevision)) return;
		const renderTargets =
			query.trim().length > 0
				? await publishCachedPdfDetails(targets, expectedGeneration, expectedRevision)
				: targets;
		if (renderTargets.length === 0 || refreshIsStale(expectedGeneration, expectedRevision)) return;
		if (detail.originalReference.provider === 'missing') {
			for (const page of renderTargets)
				failPage(page.pageNumber, 'O original não está disponível.');
			return;
		}
		try {
			if (detail.originalReference.provider === 'supabase') {
				const file = await ensureSupabasePdfFile();
				await renderPdfFileTargets(file, renderTargets, expectedGeneration, expectedRevision);
				return;
			}
			await renderDrivePdfTargets(
				detail.originalReference.driveFileId,
				renderTargets,
				expectedGeneration,
				expectedRevision
			);
		} catch {
			if (refreshIsStale(expectedGeneration, expectedRevision)) return;
			for (const page of renderTargets) {
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
		const focus = focusPageNumber;
		untrack(() => {
			if (focus === undefined) return;
			requestPage(focus);
			requestPage(focus - 1);
			requestPage(focus + 1);
		});
	});

	onDestroy(() => {
		generation += 1;
		resetMediaCaches();
	});
</script>

<div class="media-viewer">
	{#if renderedPages.length === 0}
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
