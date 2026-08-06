<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		listDriveJobs,
		runPendingDriveJobs,
		type DriveJobListItem,
		type DriveJobOperation,
		type DriveJobStatus
	} from '$lib/services/drive-jobs';

	let jobs = $state<readonly DriveJobListItem[]>([]);
	let loading = $state(true);
	let running = $state(false);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);

	const operationLabels: Record<DriveJobOperation, string> = {
		create_folder: 'Criar pasta de caderno',
		rename_folder: 'Renomear pasta',
		move_folder: 'Mover pasta',
		update_file: 'Mover arquivo',
		delete_permanently: 'Excluir original físico'
	};
	const statusLabels: Record<DriveJobStatus, string> = {
		pending: 'Pendente',
		processing: 'Em processamento',
		retryable: 'Aguardando nova tentativa',
		synced: 'Sincronizado',
		conflict: 'Conflito isolado',
		failed: 'Falha persistente',
		cancelled: 'Cancelado'
	};
	let activeCount = $derived(
		jobs.filter((job) => ['pending', 'processing', 'retryable'].includes(job.status)).length
	);
	let failedCount = $derived(jobs.filter((job) => job.status === 'failed').length);
	let conflictCount = $derived(jobs.filter((job) => job.status === 'conflict').length);

	function formatDate(value: string | null) {
		if (value === null) return '—';
		return new Intl.DateTimeFormat('pt-BR', {
			dateStyle: 'short',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function load() {
		if (running) return;
		loading = true;
		error = null;
		try {
			jobs = await listDriveJobs();
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível carregar a fila do Google Drive.';
		} finally {
			loading = false;
		}
	}

	async function run() {
		if (running || loading) return;
		running = true;
		error = null;
		message = null;
		try {
			const receipt = await runPendingDriveJobs();
			message = `${receipt.synced} mudanças sincronizadas, ${receipt.retryable} reagendadas e ${receipt.conflicts} isoladas como conflito.${receipt.status === 'partial' ? ' Ainda há itens para outra rodada.' : ''}`;
			await loadAfterRun();
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível executar a fila do Google Drive.';
		} finally {
			running = false;
		}
	}

	async function loadAfterRun() {
		try {
			jobs = await listDriveJobs();
		} catch {
			error = 'A fila foi executada, mas o estado atualizado não pôde ser carregado.';
		}
	}

	onMount(() => {
		void load();
	});
</script>

<svelte:head>
	<title>Fila do Drive — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Saída local → Drive</p>
			<h1 id="page-title">Mudanças locais</h1>
			<p>
				Aplique criação, renomeação e movimentação de pastas, mudanças de caderno e exclusões
				físicas. Cada item possui lease, retry e recibo independente.
			</p>
		</div>
		<div class="header-actions">
			<Button
				label={running ? 'Executando fila…' : 'Executar mudanças locais'}
				disabled={running || loading || activeCount === 0}
				onclick={() => void run()}
			/>
			<Button
				label={loading ? 'Atualizando…' : 'Atualizar'}
				variant="secondary"
				disabled={loading || running}
				onclick={() => void load()}
			/>
		</div>
	</header>

	<section class="summary" aria-label="Resumo da fila">
		<article>
			<strong>{activeCount}</strong>
			<span>Pendentes ou em retry</span>
		</article>
		<article>
			<strong>{conflictCount}</strong>
			<span>Conflitos isolados</span>
		</article>
		<article>
			<strong>{failedCount}</strong>
			<span>Falhas persistentes</span>
		</article>
	</section>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	<section class="panel" aria-labelledby="jobs-title">
		<div class="panel-heading">
			<div>
				<p class="eyebrow">Últimos 100 recibos</p>
				<h2 id="jobs-title">Operações</h2>
			</div>
			<span>{jobs.length}</span>
		</div>

		{#if loading}
			<p class="empty" role="status">Carregando a fila…</p>
		{:else if jobs.length === 0}
			<p class="empty">Nenhuma mudança local foi enfileirada.</p>
		{:else}
			<ul>
				{#each jobs as job (job.id)}
					<li class:attention={job.status === 'failed' || job.status === 'conflict'}>
						<div class="job-heading">
							<strong>{operationLabels[job.operation]}</strong>
							<span>{statusLabels[job.status]}</span>
						</div>
						<dl>
							<div>
								<dt>Tentativa</dt>
								<dd>{job.attemptCount}</dd>
							</div>
							<div>
								<dt>Criado</dt>
								<dd>{formatDate(job.createdAt)}</dd>
							</div>
							<div>
								<dt>Próxima tentativa</dt>
								<dd>{formatDate(job.nextRetryAt)}</dd>
							</div>
							<div>
								<dt>Finalizado</dt>
								<dd>{formatDate(job.finishedAt)}</dd>
							</div>
						</dl>
						{#if job.lastErrorMessage}
							<p class="job-error">{job.lastErrorMessage}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: 1.25rem;
	}

	header,
	.header-actions,
	.panel-heading,
	.job-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	header {
		align-items: end;
	}

	.header-actions {
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
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
		margin: 0 0 0.5rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header p:last-child {
		max-width: 58rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.summary {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.summary article,
	.panel {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.summary article {
		display: grid;
		gap: 0.25rem;
	}

	.summary strong {
		font-family: var(--font-heading);
		font-size: 2rem;
		font-weight: 600;
	}

	.summary span,
	.empty,
	dt {
		color: var(--muted);
	}

	.panel h2 {
		margin: 0;
	}

	.panel-heading > span {
		min-width: 2rem;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		background: var(--archive-soft);
		color: var(--archive);
		font-weight: 780;
		text-align: center;
	}

	ul {
		display: grid;
		gap: 0.7rem;
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 0.7rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	li.attention {
		border-left: 0.3rem solid var(--danger);
	}

	.job-heading span {
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		background: var(--archive-soft);
		color: var(--archive);
		font-size: 0.78rem;
		font-weight: 740;
	}

	dl {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
	}

	dl > div {
		display: grid;
		gap: 0.15rem;
	}

	dt {
		font-size: 0.72rem;
		font-weight: 720;
		text-transform: uppercase;
	}

	dd {
		margin: 0;
		font-size: 0.88rem;
	}

	.job-error {
		margin: 0;
		color: var(--danger);
		font-size: 0.88rem;
	}

	.empty {
		margin: 1rem 0 0;
		padding: 1rem;
		text-align: center;
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

	@media (max-width: 760px) {
		header {
			align-items: stretch;
			flex-direction: column;
		}

		.header-actions {
			justify-content: stretch;
		}

		.summary,
		dl {
			grid-template-columns: 1fr;
		}
	}
</style>
