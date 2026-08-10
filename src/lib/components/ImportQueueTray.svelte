<script lang="ts">
	import {
		cancelImport,
		importQueue,
		retryImport,
		type ImportQueueItem
	} from '$lib/stores/import-queue.svelte';
	import {
		cancelPdfImport,
		pdfImportQueue,
		retryPdfImport,
		type PdfQueueItem
	} from '$lib/stores/pdf-import-queue.svelte';

	type QueueEntry =
		| { kind: 'image'; item: ImportQueueItem }
		| { kind: 'pdf'; item: PdfQueueItem };

	let open = $state(false);
	let entries = $derived<QueueEntry[]>([
		...importQueue.items.map((item) => ({ kind: 'image' as const, item })),
		...pdfImportQueue.items.map((item) => ({ kind: 'pdf' as const, item }))
	]);
	let activeCount = $derived(
		entries.filter(({ item }) =>
			['queued', 'preparing', 'uploading', 'inspecting', 'rendering', 'publishing', 'reading', 'waiting'].includes(
				item.status
			)
		).length
	);

	const labels: Record<string, string> = {
		queued: 'Na fila',
		preparing: 'Preparando',
		inspecting: 'Analisando páginas',
		uploading: 'Enviando',
		rendering: 'Preparando páginas',
		publishing: 'Salvando no fichário',
		reading: 'Leitura iniciada',
		waiting: 'Leitura em segundo plano',
		needs_review: 'Pronto para revisão',
		complete: 'Concluído',
		duplicate: 'Já existe',
		failed: 'Falhou',
		cancelled: 'Cancelado'
	};

	function label(entry: QueueEntry) {
		return labels[entry.item.status] ?? entry.item.status;
	}

	function documentId(entry: QueueEntry) {
		return entry.item.result?.documentId ?? entry.item.duplicateDocumentId ?? null;
	}

	function canCancel(entry: QueueEntry) {
		return entry.kind === 'image'
			? ['queued', 'preparing', 'uploading'].includes(entry.item.status)
			: ['queued', 'inspecting', 'uploading', 'rendering', 'publishing'].includes(entry.item.status);
	}

	function canRetry(entry: QueueEntry) {
		return ['failed', 'cancelled', 'waiting'].includes(entry.item.status);
	}

	function cancel(entry: QueueEntry) {
		if (entry.kind === 'image') cancelImport(entry.item.id);
		else cancelPdfImport(entry.item.id);
	}

	function retry(entry: QueueEntry) {
		if (entry.kind === 'image') retryImport(entry.item.id);
		else void retryPdfImport(entry.item.id);
	}
</script>

<div class="queue-tray">
	<button
		type="button"
		class="queue-trigger"
		class:active={open}
		onclick={() => (open = !open)}
		aria-expanded={open}
		aria-controls="global-import-queue"
	>
		<span aria-hidden="true">⇩</span>
		<span>Fila</span>
		{#if activeCount > 0}<strong>{activeCount}</strong>{/if}
	</button>

	{#if open}
		<section id="global-import-queue" class="queue-panel" aria-label="Fila de importações">
			<header>
				<div>
					<strong>Importações</strong>
					<small>Você pode continuar usando o Fichário enquanto os itens são processados.</small>
				</div>
				<a href="/import/" onclick={() => (open = false)}>Adicionar</a>
			</header>

			{#if entries.length === 0}
				<p class="empty">Nenhum arquivo na fila.</p>
			{:else}
				<ul>
					{#each entries as entry (`${entry.kind}:${entry.item.id}`)}
						<li>
							<div class="kind" aria-hidden="true">{entry.kind === 'pdf' ? 'PDF' : 'IMG'}</div>
							<div class="copy">
								<strong title={entry.item.file.name}>{entry.item.file.name}</strong>
								<span>{label(entry)}</span>
								{#if entry.kind === 'pdf' && entry.item.progress}
									<small>
										{entry.item.progress.completed}/{entry.item.progress.total}{#if entry.item.progress.pageNumber}
											· página {entry.item.progress.pageNumber}{/if}
									</small>
								{/if}
								{#if entry.item.error}<small class="error">{entry.item.error}</small>{/if}
							</div>
							<div class="actions">
								{#if canCancel(entry)}
									<button type="button" onclick={() => cancel(entry)}>Cancelar</button>
								{:else if canRetry(entry)}
									<button type="button" onclick={() => retry(entry)}>Retomar</button>
								{/if}
								{#if documentId(entry)}
									<a href={`/documents/${documentId(entry)}/`} onclick={() => (open = false)}>Abrir</a>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<style>
	.queue-tray {
		position: relative;
		flex: 0 0 auto;
	}

	.queue-trigger {
		min-height: 2.7rem;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 720;
		cursor: pointer;
	}

	.queue-trigger.active,
	.queue-trigger:hover {
		background: var(--archive-soft);
		color: var(--archive);
	}

	.queue-trigger strong {
		min-width: 1.35rem;
		height: 1.35rem;
		display: grid;
		place-items: center;
		padding-inline: 0.25rem;
		border-radius: 999px;
		background: var(--archive);
		color: white;
		font-size: 0.7rem;
	}

	.queue-panel {
		position: absolute;
		z-index: 40;
		top: calc(100% + 0.7rem);
		right: 0;
		width: min(31rem, calc(100vw - 2rem));
		max-height: min(70vh, 38rem);
		overflow: auto;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--surface-strong);
		box-shadow: var(--shadow-soft);
	}

	header {
		position: sticky;
		top: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface-strong);
	}

	header > div {
		display: grid;
		gap: 0.2rem;
	}

	header strong {
		font-family: var(--font-heading);
		font-size: 1.15rem;
		font-weight: 600;
	}

	header small,
	.copy span,
	.copy small,
	.empty {
		color: var(--muted);
	}

	header small {
		max-width: 22rem;
		font-size: 0.72rem;
		line-height: 1.35;
	}

	header a,
	.actions a,
	.actions button {
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 760;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid var(--line);
	}

	li:last-child {
		border-bottom: 0;
	}

	.kind {
		width: 2.4rem;
		height: 2.4rem;
		display: grid;
		place-items: center;
		border-radius: 0.6rem;
		background: var(--archive-soft);
		color: var(--archive);
		font-size: 0.62rem;
		font-weight: 800;
	}

	.copy {
		min-width: 0;
		display: grid;
		gap: 0.12rem;
	}

	.copy strong {
		overflow: hidden;
		font-size: 0.83rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.copy span,
	.copy small {
		font-size: 0.7rem;
	}

	.copy .error {
		color: var(--danger);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.actions button {
		padding: 0;
		border: 0;
		background: transparent;
		font-family: inherit;
		cursor: pointer;
	}

	.empty {
		margin: 0;
		padding: 1.5rem 1rem;
		text-align: center;
	}

	@media (max-width: 620px) {
		.queue-trigger > span:nth-child(2) {
			display: none;
		}

		.queue-panel {
			position: fixed;
			top: calc(var(--topbar-height) + 0.5rem);
			right: 0.75rem;
			left: 0.75rem;
			width: auto;
			max-height: calc(100vh - var(--topbar-height) - var(--mobile-nav-height) - 1.5rem);
		}

		li {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.actions {
			grid-column: 2;
			justify-content: flex-start;
		}
	}
</style>
