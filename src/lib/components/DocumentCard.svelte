<script lang="ts">
	import type { DocumentSummary } from '$lib/domain/document';
	import { loadDocumentDetail } from '$lib/services/document-detail';

	interface DocumentCardProps {
		document: DocumentSummary;
		thumbnailUrl?: string | null;
		href?: string;
	}

	let {
		document: documentSummary,
		thumbnailUrl = null,
		href = `/documents/${documentSummary.id}/`
	}: DocumentCardProps = $props();
	let transitioning = $state(false);
	let detailPrefetched = false;

	const statusLabels = {
		uploading: 'Enviando',
		pending: 'Na fila',
		processing: 'Processando',
		ready: 'Pronto',
		partially_ready: 'Parcialmente pronto',
		needs_review: 'Pronto',
		failed: 'Falhou'
	} as const;

	const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});

	function prefetchDocumentDetail() {
		if (detailPrefetched) return;
		detailPrefetched = true;
		void loadDocumentDetail(documentSummary.id).catch(() => {
			detailPrefetched = false;
		});
	}

	function prepareDocumentTransition(event: MouseEvent) {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			typeof document === 'undefined' ||
			!('startViewTransition' in document)
		) {
			return;
		}

		transitioning = true;
		window.setTimeout(() => (transitioning = false), 900);
	}
</script>

<article class="document-card" class:transitioning>
	<a
		{href}
		onclick={prepareDocumentTransition}
		onpointerenter={prefetchDocumentDetail}
		onpointerdown={prefetchDocumentDetail}
		onfocus={prefetchDocumentDetail}
	>
		<div class="preview">
			{#if thumbnailUrl}
				<img src={thumbnailUrl} alt="" loading="lazy" />
			{:else}
				<div class="folio" aria-hidden="true">
					<span>{documentSummary.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
				</div>
			{/if}
			<span class={`status ${documentSummary.status}`}>{statusLabels[documentSummary.status]}</span>
		</div>
		<div class="body">
			<h2>{documentSummary.title}</h2>
			<p>
				{documentSummary.pageCount}
				{documentSummary.pageCount === 1 ? 'página' : 'páginas'} ·
				{dateFormatter.format(new Date(documentSummary.createdAt))}
			</p>
		</div>
	</a>
</article>

<style>
	.document-card {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
		transform: translateY(0) scale(1);
		animation: document-card-enter var(--motion-slow) var(--ease-soft) both;
		transition:
			border-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-slow) var(--ease-soft),
			transform var(--motion-base) var(--ease-emphasized);
	}

	.document-card.transitioning {
		view-transition-name: selected-document;
	}

	@keyframes document-card-enter {
		from {
			opacity: 0;
			transform: translateY(0.55rem) scale(0.99);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.document-card:focus-within {
		border-color: var(--line-strong);
		box-shadow: var(--shadow-soft);
		transform: translateY(-0.18rem) scale(1.002);
	}

	a {
		display: block;
		transform: scale(1);
		transition: transform var(--motion-base) var(--ease-emphasized);
	}

	a:active {
		transform: scale(0.986);
		transition-duration: var(--motion-instant);
	}

	.preview {
		position: relative;
		min-height: 12rem;
		display: grid;
		place-items: center;
		overflow: hidden;
		background:
			linear-gradient(135deg, rgb(var(--archive-rgb) / 8%), rgb(var(--accent-rgb) / 8%)),
			var(--paper);
	}

	.preview::after {
		position: absolute;
		inset: 0;
		content: '';
		pointer-events: none;
		background: linear-gradient(180deg, transparent 55%, rgb(var(--ink-rgb) / 5%));
		opacity: 0;
		transition: opacity var(--motion-slow) var(--ease-soft);
	}

	img {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: cover;
		transform: scale(1);
		transition: transform var(--motion-slow) var(--ease-soft);
	}

	.folio {
		width: 6.5rem;
		height: 8.25rem;
		display: grid;
		place-items: end center;
		padding: 0.8rem;
		border: 1px solid var(--line-strong);
		border-left: 0.55rem solid var(--archive);
		border-radius: 0.25rem 0.6rem 0.6rem 0.25rem;
		background: var(--surface-strong);
		box-shadow: var(--shadow-raised);
		transform: translateY(0) rotate(0deg);
		transition: transform var(--motion-slow) var(--ease-emphasized);
	}

	.folio span {
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.1em;
	}

	.status {
		position: absolute;
		z-index: 1;
		top: 0.75rem;
		right: 0.75rem;
		padding: 0.3rem 0.5rem;
		border-radius: 99rem;
		background: rgb(var(--surface-rgb) / 92%);
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 760;
		box-shadow: 0 0.2rem 0.8rem rgb(var(--ink-rgb) / 8%);
		backdrop-filter: blur(0.45rem);
		transform: translateY(0);
		transition:
			box-shadow var(--motion-base) var(--ease-soft),
			transform var(--motion-base) var(--ease-emphasized);
	}

	.status.ready,
	.status.needs_review {
		color: var(--archive);
	}

	.status.partially_ready {
		color: var(--accent-strong);
	}

	.status.failed {
		color: var(--danger);
	}

	.body {
		padding: 1rem;
	}

	h2 {
		overflow: hidden;
		margin-bottom: 0.4rem;
		font-family: var(--font-heading);
		font-size: 1.22rem;
		font-weight: 560;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	p {
		margin-bottom: 0;
		color: var(--muted);
		font-size: 0.8rem;
	}

	@media (hover: hover) and (pointer: fine) {
		.document-card:hover {
			border-color: var(--line-strong);
			box-shadow: var(--shadow-raised);
			transform: translateY(-0.24rem) scale(1.003);
		}

		.document-card:hover .preview::after {
			opacity: 1;
		}

		.document-card:hover img {
			transform: scale(1.035);
		}

		.document-card:hover .folio {
			transform: translateY(-0.16rem) rotate(-0.35deg);
		}

		.document-card:hover .status {
			box-shadow: 0 0.35rem 1rem rgb(var(--ink-rgb) / 11%);
			transform: translateY(-1px);
		}
	}
</style>
