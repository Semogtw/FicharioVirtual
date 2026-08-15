<script lang="ts">
	import { env } from '$env/dynamic/public';
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { parsePublicEnv } from '$lib/env/public';
	import {
		createDesktopOcrPairingCode,
		deleteDesktopOcrDevice,
		listDesktopOcrDevices,
		renameDesktopOcrDevice,
		revokeDesktopOcrDevice,
		type DesktopOcrDevice,
		type DesktopOcrPairingCode
	} from '$lib/services/desktop-ocr-devices';
	import { RequestVersion } from '$lib/services/request-version';

	const publicConfig = parsePublicEnv(env);
	const workerEndpoint = new URL(
		'/functions/v1/desktop-ocr-worker',
		publicConfig.PUBLIC_SUPABASE_URL
	).toString();
	const preferredPairCommand = `fichario-worker-pair-code ${workerEndpoint} "Meu computador"`;

	let devices = $state<readonly DesktopOcrDevice[]>([]);
	let pairing = $state<DesktopOcrPairingCode | null>(null);
	let loading = $state(true);
	let creatingPairingCode = $state(false);
	let revokingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let savingLabelId = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let editingLabel = $state('');
	let confirmingId = $state<string | null>(null);
	let deleteConfirmingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);
	const requests = new RequestVersion();
	const pairingRequests = new RequestVersion();

	const dateTime = new Intl.DateTimeFormat('pt-BR', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function formatDate(value: string | null) {
		if (!value) return 'Nunca';
		return dateTime.format(new Date(value));
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
			error =
				caught instanceof Error ? caught.message : 'Não foi possível carregar os computadores.';
		} finally {
			if (requests.isCurrent(version)) loading = false;
		}
	}

	async function generatePairingCode() {
		if (creatingPairingCode) return;
		const version = pairingRequests.next();
		creatingPairingCode = true;
		error = null;
		message = null;
		try {
			const next = await createDesktopOcrPairingCode();
			if (!pairingRequests.isCurrent(version)) return;
			pairing = next;
			message = 'Código criado. O código anterior, se existia, foi invalidado.';
		} catch (caught) {
			if (!pairingRequests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível gerar o código.';
		} finally {
			if (pairingRequests.isCurrent(version)) creatingPairingCode = false;
		}
	}

	async function copyPairingCode() {
		if (!pairing) return;
		try {
			await navigator.clipboard.writeText(pairing.code);
			message = 'Código copiado.';
		} catch {
			message = 'Selecione e copie o código exibido abaixo.';
		}
	}

	async function copyPairCommand() {
		try {
			await navigator.clipboard.writeText(preferredPairCommand);
			message = 'Comando copiado.';
		} catch {
			message = 'Selecione e copie o comando exibido abaixo.';
		}
	}

	function beginRename(device: DesktopOcrDevice) {
		if (device.status !== 'active' || revokingId || deletingId || savingLabelId) return;
		confirmingId = null;
		deleteConfirmingId = null;
		message = null;
		error = null;
		editingId = device.id;
		editingLabel = device.label;
	}

	function cancelRename() {
		editingId = null;
		editingLabel = '';
	}

	async function saveRename(device: DesktopOcrDevice) {
		if (
			device.status !== 'active' ||
			editingId !== device.id ||
			revokingId ||
			deletingId ||
			savingLabelId
		) {
			return;
		}

		const normalizedLabel = editingLabel.trim();
		if (normalizedLabel.length < 1 || normalizedLabel.length > 80) {
			error = 'Use um nome entre 1 e 80 caracteres.';
			return;
		}
		if (normalizedLabel === device.label) {
			cancelRename();
			return;
		}

		const version = requests.next();
		savingLabelId = device.id;
		error = null;
		message = null;
		try {
			const receipt = await renameDesktopOcrDevice(device.id, normalizedLabel);
			if (!requests.isCurrent(version)) return;
			devices = devices.map((item) =>
				item.id === device.id
					? { ...item, label: receipt.label, updatedAt: receipt.updatedAt }
					: item
			);
			cancelRename();
			message = `${receipt.label} foi renomeado.`;
		} catch (caught) {
			if (!requests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível renomear o computador.';
		} finally {
			if (requests.isCurrent(version)) savingLabelId = null;
		}
	}

	async function revoke(device: DesktopOcrDevice) {
		if (revokingId || deletingId || savingLabelId || device.status !== 'active') return;
		if (confirmingId !== device.id) {
			cancelRename();
			deleteConfirmingId = null;
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
					? `${device.label} foi revogado. Apague a credencial local com fichario-worker-forget --after-web-revoke.`
					: `${device.label} foi revogado e ${receipt.requeuedJobs} trabalho(s) voltaram para a fila. Apague a credencial local com fichario-worker-forget --after-web-revoke.`;
		} catch (caught) {
			if (!requests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível revogar o computador.';
		} finally {
			if (requests.isCurrent(version)) revokingId = null;
		}
	}

	async function removeRevoked(device: DesktopOcrDevice) {
		if (revokingId || deletingId || savingLabelId || device.status !== 'revoked') return;
		if (deleteConfirmingId !== device.id) {
			confirmingId = null;
			deleteConfirmingId = device.id;
			message = 'Confirme a remoção. O computador já revogado desaparecerá desta lista.';
			return;
		}

		const version = requests.next();
		deletingId = device.id;
		deleteConfirmingId = null;
		error = null;
		message = null;
		try {
			await deleteDesktopOcrDevice(device.id);
			if (!requests.isCurrent(version)) return;
			devices = devices.filter((item) => item.id !== device.id);
			message = `${device.label} foi removido da lista.`;
		} catch (caught) {
			if (!requests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível remover o computador.';
		} finally {
			if (requests.isCurrent(version)) deletingId = null;
		}
	}

	function cancelConfirmation() {
		confirmingId = null;
		message = null;
	}

	function cancelDeleteConfirmation() {
		deleteConfirmingId = null;
		message = null;
	}

	onMount(() => {
		void refreshDevices();
	});

	onDestroy(() => {
		requests.next();
		pairingRequests.next();
	});
</script>

<svelte:head>
	<title>Computadores — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Leitura local</p>
		<div class="header-row">
			<div>
				<h1 id="page-title">Computadores</h1>
				<p>Gerencie os computadores conectados ao Fichário.</p>
			</div>
			<Button
				label={loading ? 'Atualizando…' : 'Atualizar'}
				disabled={loading || !!revokingId || !!deletingId || !!savingLabelId}
				onclick={() => void refreshDevices()}
			/>
		</div>
	</header>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	<section class="info-card pairing-card" aria-labelledby="pairing-title">
		<div class="pairing-copy">
			<p class="eyebrow">Novo computador</p>
			<h2 id="pairing-title">Conectar computador</h2>
			<p>Gere um código e use-o no computador que deseja conectar.</p>
		</div>
		<div class="pairing-action">
			<span class="badge">Conexão segura</span>
			<Button
				label={creatingPairingCode ? 'Gerando…' : pairing ? 'Gerar outro código' : 'Gerar código'}
				disabled={creatingPairingCode}
				onclick={() => void generatePairingCode()}
			/>
		</div>

		{#if pairing}
			<div class="pairing-receipt" role="region" aria-label="Código de pareamento ativo">
				<div class="pairing-code-row">
					<div>
						<span class="field-label">Código de uso único</span>
						<code class="pairing-code">{pairing.code}</code>
					</div>
					<button type="button" class="copy-button" onclick={() => void copyPairingCode()}>
						Copiar código
					</button>
				</div>
				<p class="expiry">
					Expira em {formatDate(pairing.expiresAt)}. Um novo código invalida este.
				</p>
				<div class="command-block">
					<span class="field-label">No computador, execute</span>
					<code>{preferredPairCommand}</code>
					<button type="button" class="copy-button" onclick={() => void copyPairCommand()}>
						Copiar comando
					</button>
				</div>
				<p class="pairing-help">
					Troque “Meu computador” pelo nome desejado. Depois, use “Atualizar” para ver o
					dispositivo.
				</p>
			</div>
		{/if}
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
				<p>Gere um código acima e conclua a conexão no computador.</p>
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
								{#if editingId === device.id}
									<form
										class="rename-form"
										onsubmit={(event) => {
											event.preventDefault();
											void saveRename(device);
										}}
									>
										<input
											type="text"
											bind:value={editingLabel}
											maxlength="80"
											autocomplete="off"
											aria-label={`Novo nome de ${device.label}`}
											disabled={savingLabelId === device.id}
										/>
										<button type="submit" class="secondary" disabled={savingLabelId === device.id}>
											{savingLabelId === device.id ? 'Salvando…' : 'Salvar nome'}
										</button>
										<button
											type="button"
											class="secondary"
											disabled={savingLabelId === device.id}
											onclick={cancelRename}
										>
											Cancelar
										</button>
									</form>
								{:else}
									{#if confirmingId !== device.id}
										<button
											type="button"
											class="secondary"
											disabled={!!revokingId || !!deletingId || !!savingLabelId}
											onclick={() => beginRename(device)}
										>
											Renomear
										</button>
									{/if}
									{#if confirmingId === device.id}
										<button
											type="button"
											class="secondary"
											disabled={!!revokingId}
											onclick={cancelConfirmation}
										>
											Cancelar
										</button>
									{/if}
									<button
										type="button"
										class:confirming={confirmingId === device.id}
										disabled={!!revokingId || !!deletingId || !!savingLabelId}
										onclick={() => void revoke(device)}
									>
										{revokingId === device.id
											? 'Revogando…'
											: confirmingId === device.id
												? 'Confirmar revogação'
												: 'Revogar'}
									</button>
								{/if}
							</div>
						{:else}
							<div class="device-actions">
								{#if deleteConfirmingId === device.id}
									<button
										type="button"
										class="secondary"
										disabled={!!deletingId}
										onclick={cancelDeleteConfirmation}
									>
										Cancelar
									</button>
								{/if}
								<button
									type="button"
									class:confirming={deleteConfirmingId === device.id}
									disabled={!!revokingId || !!deletingId || !!savingLabelId}
									onclick={() => void removeRevoked(device)}
								>
									{deletingId === device.id
										? 'Removendo…'
										: deleteConfirmingId === device.id
											? 'Confirmar remoção'
											: 'Remover da lista'}
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
	.empty p {
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

	.pairing-card {
		align-items: start;
	}

	.pairing-copy {
		min-width: 0;
	}

	.pairing-action {
		display: grid;
		justify-items: end;
		gap: 0.6rem;
	}

	.pairing-receipt {
		grid-column: 1 / -1;
		display: grid;
		gap: 0.8rem;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.pairing-code-row,
	.command-block {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.pairing-code-row > div,
	.command-block {
		min-width: 0;
	}

	.field-label {
		display: block;
		margin-bottom: 0.25rem;
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.pairing-code,
	.command-block code {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		padding: 0.45rem 0.6rem;
		border-radius: 0.45rem;
		background: var(--surface);
		color: var(--ink);
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.pairing-code {
		font-size: clamp(1.1rem, 3vw, 1.55rem);
		font-weight: 780;
		letter-spacing: 0.08em;
	}

	.expiry,
	.pairing-help {
		font-size: 0.82rem;
	}

	.copy-button {
		min-height: 2.35rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--muted-strong);
		font-weight: 720;
		cursor: pointer;
		white-space: nowrap;
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

	.device-actions,
	.rename-form {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.rename-form {
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.rename-form input {
		width: min(18rem, 100%);
		min-height: 2.45rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
	}

	.rename-form input:focus-visible,
	.copy-button:focus-visible {
		outline: 3px solid var(--focus-ring);
		outline-offset: 2px;
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

	.device-actions button:disabled,
	.rename-form input:disabled {
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

		.pairing-action {
			justify-items: stretch;
		}

		.pairing-code-row,
		.command-block {
			align-items: stretch;
			flex-direction: column;
		}

		.copy-button {
			width: 100%;
		}

		.device-actions,
		.rename-form {
			justify-content: stretch;
		}

		.device-actions,
		.rename-form,
		.rename-form input {
			width: 100%;
		}

		.device-actions button,
		.rename-form button {
			flex: 1;
		}
	}
</style>
