<script lang="ts">
	import type { DocumentSummary } from '$lib/domain/document';

	interface DocumentCardProps {
		document: DocumentSummary;
		thumbnailUrl?: string | null;
		href?: string;
	}

	let {
		document,
		thumbnailUrl = null,
		href = `/documents/${document.id}/`
	}: DocumentCardProps = $props();

	const statusLabels = {
		uploading: 'Enviando',
		pending: 'Na fila',
		processing: 'Processando',
		ready: 'Pronto',
		partially_ready: 'Parcialmente pronto',
		needs_review: 'Revisar',
		failed: 'Falhou'
	} as const;

	const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});
</script>

<article class="document-card">
	<a {href} aria-label={`Abrir ${document.title}`}>
		<div class="preview">
			{#if thumbnailUrl}
				<img src={thumbnailUrl} alt="" loading="lazy" />
			{:else}
				<div class="folio" aria-hidden="true">
					<span>{document.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
				</div>
			{/if}
			<span class={`status ${document.status}`}>{statusLabels[document.status]}</span>
		</div>
		<div class="body">
			<h2>{document.title}</h2>
			<p>
				{document.pageCount}
				{document.pageCount === 1 ? 'página' : 'páginas'} ·
				{dateFormatter.format(new Date(document.createdAt))}
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
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease,
			transform 120ms ease;
	}

	.document-card:hover {
		border-color: var(--line-strong);
		box-shadow: var(--shadow-soft);
		transform: translateY(-0.125rem);
	}

	a {
		display: block;
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

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
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
	}

	.folio span {
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.1em;
	}

	.status {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		padding: 0.3rem 0.5rem;
		border-radius: 99rem;
		background: rgb(var(--surface-rgb) / 92%);
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 760;
		box-shadow: 0 0.2rem 0.8rem rgb(var(--ink-rgb) / 8%);
	}

	.status.ready {
		color: var(--archive);
	}

	.status.needs_review,
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
</style>
