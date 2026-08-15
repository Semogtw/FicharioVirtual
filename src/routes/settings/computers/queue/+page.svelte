<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		listDesktopOcrJobs,
		returnDesktopOcrJobToGemini,
		type DesktopOcrJob,
		type DesktopOcrJobStatus
	} from '$lib/services/desktop-ocr-jobs';
	import { RequestVersion } from '$lib/services/request-version';

	let jobs = $state<readonly DesktopOcrJob[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let movingPageId = $state<string | null>(null);
	const requests = new RequestVersion();

	const dateTime = new Intl.DateTimeFormat('pt-BR', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function formatDate(value: string | null) {
		return value ? dateTime.format(new Date(value)) : '—';
	}

	function statusLabel(status: DesktopOcrJobStatus, leaseExpired: boolean) {
		if (status === 'processing' && leaseExpired) return 'Precisa de atenção';
		const labels: Record<DesktopOcrJobStatus, string> = {
			pending: 'Pendente',
			processing: 'Processando',
			ready: 'Concluído',
			retryable: 'Tentará novamente',
			blocked_quota: 'Bloqueado',
			needs_review: 'Revisão necessária',
			failed: 'Falhou',
			waiting_desktop: 'Aguardando computador'
		};
		return labels[status];
	}

	function canReturnToGemini(job: DesktopOcrJob) {
		return job.status === 'waiting_desktop' || (job.status === 'processing' && job.leaseExpired);
	}

	function isActive(job: DesktopOcrJob) {
		return (
			job.status === 'waiting_desktop' || job.status === 'processing' || job.status === 'retryable'
		);
	}

	async function returnToGemini(job: DesktopOcrJob) {
		if (!canReturnToGemini(job) || loading || movingPageId !== null) return;
		movingPageId = job.pageId;
		error = null;
		notice = null;
		try {
			await returnDesktopOcrJobToGemini(job.pageId);
			jobs = jobs.filter((item) => item.pageId !== job.pageId);
			notice = 'A página voltou para a leitura automática.';
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível devolver a página para a leitura automática.';
		} finally {
			if (movingPageId === job.pageId) movingPageId = null;
		}
	}

	async function refreshJobs() {
		const version = requests.next();
		loading = true;
		error = null;
		notice = null;
		try {
			const next = await listDesktopOcrJobs();
			if (!requests.isCurrent(version)) return;
			jobs = next;
		} catch (caught) {
			if (!requests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível carregar a fila local.';
		} finally {
			if (requests.isCurrent(version)) loading = false;
		}
	}

	onMount(() => {
		void refreshJobs();
	});

	onDestroy(() => {
		requests.next();
	});
</script>

<svelte:head>
	<title>Fila de leitura local — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header class="header-row">
		<div>
			<p class="eyebrow">Leitura local</p>
			<h1 id="page-title">Fila de leitura</h1>
			<p>Acompanhe as páginas enviadas aos seus computadores.</p>
		</div>
		<Button
			label={loading ? 'Atualizando…' : 'Atualizar fila'}
			disabled={loading || movingPageId !== null}
			onclick={() => void refreshJobs()}
		/>
	</header>

	<nav class="subnav" aria-label="Leitura local">
		<a href="/settings/computers/">Computadores</a>
		<a href="/settings/computers/queue/" aria-current="page">Fila de leitura</a>
	</nav>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}

	<section class="summary" aria-label="Resumo da fila">
		<div>
			<strong>{jobs.filter(isActive).length}</strong>
			<span>ativos</span>
		</div>
		<div>
			<strong>{jobs.filter((job) => job.status === 'waiting_desktop').length}</strong>
			<span>aguardando</span>
		</div>
		<div>
			<strong
				>{jobs.filter((job) => job.status === 'processing' && !job.leaseExpired).length}</strong
			>
			<span>processando</span>
		</div>
		<div>
			<strong>{jobs.filter((job) => job.leaseExpired).length}</strong>
			<span>precisam de atenção</span>
		</div>
	</section>

	<section class="queue" aria-labelledby="queue-title" aria-busy={loading}>
		<div class="section-heading">
			<div>
				<p class="eyebrow">Itens recentes</p>
				<h2 id="queue-title">{jobs.length} item(ns)</h2>
			</div>
			<span class="limit">Até 100 itens recentes</span>
		</div>

		{#if loading && jobs.length === 0}
			<div class="empty" role="status">Carregando…</div>
		{:else if jobs.length === 0}
			<div class="empty">
				<strong>Nenhuma página aguardando leitura local.</strong>
				<p>Quando uma página for enviada a um computador, ela aparecerá aqui.</p>
			</div>
		{:else}
			<div class="job-list">
				{#each jobs as job (job.id)}
					<article class:expired={job.leaseExpired}>
						<div class="job-main">
							<div class="title-row">
								<a class="document-link" href={`/documents/${job.documentId}/`}>
									{job.documentTitle}
								</a>
								<span class="page-number">Página {job.pageNumber}</span>
								<span
									class="status-badge"
									class:processing={job.status === 'processing' && !job.leaseExpired}
									class:waiting={job.status === 'waiting_desktop'}
									class:warning={job.leaseExpired || job.status === 'retryable'}
								>
									{statusLabel(job.status, job.leaseExpired)}
								</span>
							</div>

							{#if job.leaseExpired}
								<p class="lease-warning">
									Este computador parou de responder. Você pode devolver a página para a leitura
									automática ou aguardar outro computador.
								</p>
							{/if}

							<dl>
								<div>
									<dt>Computador</dt>
									<dd>{job.deviceLabel ?? 'Ainda não reivindicado'}</dd>
								</div>
								<div>
									<dt>Tentativas</dt>
									<dd>{job.attemptCount}</dd>
								</div>
								<div>
									<dt>Atualizado</dt>
									<dd>{formatDate(job.updatedAt)}</dd>
								</div>
								{#if job.leaseExpiresAt}
									<div>
										<dt>Prazo atual</dt>
										<dd>{formatDate(job.leaseExpiresAt)}</dd>
									</div>
								{/if}
								{#if job.lastErrorCode}
									<div>
										<dt>Último erro</dt>
										<dd><code>{job.lastErrorCode}</code></dd>
									</div>
								{/if}
							</dl>

							{#if canReturnToGemini(job)}
								<div class="job-actions">
									<Button
										label={movingPageId === job.pageId ? 'Movendo…' : 'Usar leitura automática'}
										disabled={loading || movingPageId !== null}
										onclick={() => void returnToGemini(job)}
									/>
								</div>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
	}

	.header-row,
	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0 0 0.4rem;
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 540;
	}

	h1 {
		margin: 0 0 0.55rem;
		font-size: clamp(2.35rem, 6vw, 4.25rem);
		letter-spacing: -0.04em;
	}

	h2 {
		margin: 0;
		font-size: 1.35rem;
	}

	header p:last-child,
	.empty p {
		max-width: 54rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.subnav {
		display: flex;
		gap: 0.4rem;
	}

	.subnav a {
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--muted-strong);
		font-size: 0.82rem;
		font-weight: 720;
	}

	.subnav a[aria-current='page'] {
		border-color: var(--archive);
		background: var(--archive-soft);
		color: var(--archive);
	}

	.summary {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.65rem;
	}

	.summary > div,
	.queue {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.summary > div {
		display: grid;
		gap: 0.15rem;
		padding: 0.85rem 1rem;
	}

	.summary strong {
		font-family: var(--font-heading);
		font-size: 1.55rem;
		font-weight: 600;
	}

	.summary span,
	.limit {
		color: var(--muted);
		font-size: 0.78rem;
	}

	.queue {
		padding: 1rem;
	}

	.job-list {
		display: grid;
		gap: 0.7rem;
		margin-top: 0.8rem;
	}

	article {
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	article.expired {
		border-color: rgb(var(--warning-rgb) / 40%);
	}

	.title-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.document-link {
		color: var(--ink);
		font-family: var(--font-heading);
		font-size: 1.05rem;
		font-weight: 590;
	}

	.document-link:hover {
		text-decoration: underline;
	}

	.page-number,
	.status-badge {
		font-size: 0.74rem;
		font-weight: 740;
	}

	.page-number {
		color: var(--muted);
	}

	.status-badge {
		padding: 0.24rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted-strong);
	}

	.status-badge.processing {
		border-color: rgb(var(--success-rgb) / 30%);
		color: var(--success);
	}

	.status-badge.waiting {
		border-color: rgb(var(--archive-rgb) / 30%);
		color: var(--archive);
	}

	.status-badge.warning {
		border-color: rgb(var(--warning-rgb) / 35%);
		color: var(--warning);
	}

	.lease-warning {
		margin: 0.6rem 0 0;
		padding: 0.55rem 0.65rem;
		border-radius: var(--radius-sm);
		background: rgb(var(--warning-rgb) / 8%);
		color: var(--muted-strong);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	dl {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem 1.4rem;
		margin: 0.7rem 0 0;
	}

	dl div {
		display: grid;
		gap: 0.1rem;
	}

	dt {
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 760;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	dd {
		margin: 0;
		font-size: 0.83rem;
		font-weight: 650;
	}

	dd code {
		font-size: 0.78rem;
	}

	.job-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.75rem;
	}

	.empty {
		margin-top: 0.8rem;
		padding: 1.1rem;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.empty strong {
		display: block;
		margin-bottom: 0.25rem;
	}

	.notice {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border: 1px solid rgb(var(--success-rgb) / 28%);
		border-radius: var(--radius-sm);
		background: rgb(var(--success-rgb) / 8%);
		color: var(--success);
	}

	.error {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border: 1px solid rgb(var(--danger-rgb) / 28%);
		border-radius: var(--radius-sm);
		background: rgb(var(--danger-rgb) / 8%);
		color: var(--danger);
	}

	@media (max-width: 760px) {
		.header-row,
		.section-heading {
			align-items: stretch;
			flex-direction: column;
		}

		.summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 440px) {
		.summary {
			grid-template-columns: 1fr;
		}
	}
</style>
