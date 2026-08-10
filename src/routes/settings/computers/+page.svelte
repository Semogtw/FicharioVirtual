<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		listDesktopOcrDevices,
		revokeDesktopOcrDevice,
		type DesktopOcrDevice
	} from '$lib/services/desktop-ocr-devices';
	import { RequestVersion } from '$lib/services/request-version';

	let devices = $state<readonly DesktopOcrDevice[]>([]);
	let loading = $state(true);
	let revokingId = $state<string | null>(null);
	let confirmingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);
	const requests = new RequestVersion();

	const dateTime = new Intl.DateTimeFormat('pt-BR', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function formatDate(value: string | null) {
		if (!value) return 'Nunca';
		return dateTime.format(new Date(value));
	}

	function capabilitySummary(device: DesktopOcrDevice) {
		const parts: string[] = [];
		if (device.capabilities.backend) parts.push(device.capabilities.backend);
		if (device.capabilities.model) parts.push(device.capabilities.model);
		if (device.capabilities.maxConcurrency) {
			parts.push(`${device.capabilities.maxConcurrency} trabalho por vez`);
		}
		return parts.length > 0 ? parts.join(' · ') : 'Capacidades não informadas';
	}

	async function refreshDevices() {
		const version = requests.next();
		loading = true;
		error = null;
		try {
			const next = await listDesktopOcrDevices();
			if (!requests.isCurrent(version)) return;
			devices = next;
		} catch (caught) {
			if (!requests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível carregar os computadores.';
		} finally {
			if (requests.isCurrent(version)) loading = false;
		}
	}

	async function revoke(device: DesktopOcrDevice) {
		if (revokingId || device.status !== 'active') return;
		if (confirmingId !== device.id) {
			confirmingId = device.id;
			message = 'Confirme a revogação. Trabalhos em execução voltarão para a fila.';
			return;
		}

		const version = requests.next();
		revokingId = device.id;
		confirmingId = null;
		error = null;
		message = null;
		try {
			const receipt = await revokeDesktopOcrDevice(device.id);
			if (!requests.isCurrent(version)) return;
			devices = devices.map((item) =>
				item.id === device.id
					? {
							...item,
							status: 'revoked' as const,
							revokedAt: receipt.revokedAt,
							updatedAt: receipt.revokedAt
						}
					: item
			);
			message =
				receipt.requeuedJobs === 0
					? `${device.label} foi revogado.`
					: `${device.label} foi revogado e ${receipt.requeuedJobs} trabalho(s) voltaram para a fila.`;
		} catch (caught) {
			if (!requests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível revogar o computador.';
		} finally {
			if (requests.isCurrent(version)) revokingId = null;
		}
	}

	function cancelConfirmation() {
		confirmingId = null;
		message = null;
	}

	onMount(() => {
		void refreshDevices();
	});

	onDestroy(() => {
		requests.next();
	});
</script>

<svelte:head>
	<title>Computadores de OCR — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">OCR local</p>
		<div class="header-row">
			<div>
				<h1 id="page-title">Computadores</h1>
				<p>
					Gerencie dispositivos autorizados a processar páginas localmente. Credenciais do worker
					nunca são exibidas nesta tela.
				</p>
			</div>
			<Button label={loading ? 'Atualizando…' : 'Atualizar'} disabled={loading || !!revokingId} onclick={() => void refreshDevices()} />
		</div>
	</header>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	<section class="info-card" aria-labelledby="pairing-title">
		<div>
			<h2 id="pairing-title">Pareamento seguro</h2>
			<p>
				O worker usa uma credencial própria guardada no Secret Service do computador. A sessão do
				navegador não é persistida no dispositivo e nenhum computador abre porta pública.
			</p>
		</div>
		<span class="badge">Saída HTTPS apenas</span>
	</section>

	<section class="devices" aria-labelledby="devices-title" aria-busy={loading}>
		<div class="section-heading">
			<div>
				<p class="eyebrow">Dispositivos autorizados</p>
				<h2 id="devices-title">{devices.length} computador(es)</h2>
			</div>
		</div>

		{#if loading && devices.length === 0}
			<div class="empty" role="status">Carregando computadores…</div>
		{:else if devices.length === 0}
			<div class="empty">
				<strong>Nenhum computador pareado.</strong>
				<p>Quando um worker for pareado, ele aparecerá aqui para acompanhamento e revogação.</p>
			</div>
		{:else}
			<div class="device-list">
				{#each devices as device (device.id)}
					<article class:revoked={device.status === 'revoked'}>
						<div class="device-main">
							<div class="title-row">
								<h3>{device.label}</h3>
								<span class:active={device.status === 'active'} class="status-badge">
									{device.status === 'active' ? 'Ativo' : 'Revogado'}
								</span>
							</div>
							<p class="capabilities">{capabilitySummary(device)}</p>
							<dl>
								<div>
									<dt>Último contato</dt>
									<dd>{formatDate(device.lastSeenAt)}</dd>
								</div>
								<div>
									<dt>Pareado em</dt>
									<dd>{formatDate(device.createdAt)}</dd>
								</div>
								{#if device.revokedAt}
									<div>
										<dt>Revogado em</dt>
										<dd>{formatDate(device.revokedAt)}</dd>
									</div>
								{/if}
							</dl>
						</div>

						{#if device.status === 'active'}
							<div class="device-actions">
								{#if confirmingId === device.id}
									<button type="button" class="secondary" disabled={!!revokingId} onclick={cancelConfirmation}>
										Cancelar
									</button>
								{/if}
								<button
									type="button"
									class:confirming={confirmingId === device.id}
									disabled={!!revokingId}
									onclick={() => void revoke(device)}
								>
									{revokingId === device.id
										? 'Revogando…'
										: confirmingId === device.id
											? 'Confirmar revogação'
											: 'Revogar'}
								</button>
							</div>
						{/if}
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

	.eyebrow {
		margin: 0 0 0.4rem;
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.header-row,
	.info-card,
	article {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
	}

	h1,
	h2,
	h3 {
		font-family: var(--font-heading);
		font-weight: 540;
	}

	h1 {
		margin: 0 0 0.55rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header p:last-child,
	.info-card p,
	.empty p,
	.capabilities {
		max-width: 52rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.info-card,
	.devices {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.info-card h2,
	.devices h2 {
		margin: 0 0 0.35rem;
		font-size: 1.35rem;
	}

	.badge,
	.status-badge {
		display: inline-flex;
		align-items: center;
		min-height: 1.8rem;
		padding: 0.25rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface-strong);
		color: var(--muted-strong);
		font-size: 0.75rem;
		font-weight: 760;
		white-space: nowrap;
	}

	.status-badge.active {
		border-color: rgb(var(--success-rgb) / 30%);
		background: rgb(var(--success-rgb) / 9%);
		color: var(--success);
	}

	.device-list {
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

	article.revoked {
		opacity: 0.68;
	}

	.title-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	h3 {
		margin: 0;
		font-size: 1.1rem;
	}

	.capabilities {
		margin-top: 0.25rem;
		font-size: 0.86rem;
	}

	dl {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem 1.4rem;
		margin: 0.65rem 0 0;
	}

	dl div {
		display: grid;
		gap: 0.1rem;
	}

	dt {
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 760;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	dd {
		margin: 0;
		font-size: 0.84rem;
		font-weight: 650;
	}

	.device-actions {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.device-actions button {
		min-height: 2.45rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid rgb(var(--danger-rgb) / 35%);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--danger);
		font-weight: 740;
		cursor: pointer;
	}

	.device-actions button.confirming {
		background: var(--danger);
		color: white;
	}

	.device-actions button.secondary {
		border-color: var(--line-strong);
		color: var(--muted-strong);
	}

	.device-actions button:disabled {
		cursor: wait;
		opacity: 0.6;
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

	.error,
	.message {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border-radius: var(--radius-sm);
	}

	.error {
		border: 1px solid rgb(var(--danger-rgb) / 28%);
		background: rgb(var(--danger-rgb) / 8%);
		color: var(--danger);
	}

	.message {
		border: 1px solid var(--line);
		background: var(--archive-soft);
		color: var(--muted-strong);
	}

	@media (max-width: 720px) {
		.header-row,
		.info-card,
		article {
			grid-template-columns: 1fr;
		}

		.device-actions {
			justify-content: stretch;
		}

		.device-actions button {
			flex: 1;
		}
	}
</style>
