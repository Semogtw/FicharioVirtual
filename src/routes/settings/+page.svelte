<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import DriveConnectionCard from '$lib/components/DriveConnectionCard.svelte';
	import InstallAppButton from '$lib/components/InstallAppButton.svelte';
	import ThemePicker from '$lib/components/ThemePicker.svelte';
	import { createPortableExport, downloadPortableExport } from '$lib/services/export';
	import { RequestVersion } from '$lib/services/request-version';
	import { endSession, sessionState } from '$lib/stores/session.svelte';

	let exporting = $state(false);
	let signingOut = $state(false);
	let signedOut = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);
	const exportRequests = new RequestVersion();
	const signOutRequests = new RequestVersion();

	async function exportData() {
		if (exporting || signingOut) return;
		const version = exportRequests.next();
		exporting = true;
		error = null;
		message = null;
		try {
			const manifest = await createPortableExport();
			if (!exportRequests.isCurrent(version)) return;
			downloadPortableExport(manifest);
			message = 'Sua cópia de dados foi baixada.';
		} catch (caught) {
			if (!exportRequests.isCurrent(version)) return;
			error = caught instanceof Error ? caught.message : 'Não foi possível baixar seus dados.';
		} finally {
			if (exportRequests.isCurrent(version)) exporting = false;
		}
	}

	async function signOut() {
		if (signingOut || exporting) return;
		if (signedOut) return;
		const version = signOutRequests.next();
		signingOut = true;
		error = null;
		message = null;
		try {
			try {
				await endSession();
				if (!signOutRequests.isCurrent(version)) return;
			} catch {
				if (!signOutRequests.isCurrent(version)) return;
				error = sessionState.error ?? 'Não foi possível sair agora.';
				return;
			}
			signedOut = true;
			try {
				await goto('/login/');
			} catch {
				if (!signOutRequests.isCurrent(version)) return;
				error = 'Você saiu da conta, mas a tela de acesso não abriu automaticamente.';
			}
		} finally {
			if (signOutRequests.isCurrent(version)) signingOut = false;
		}
	}

	onDestroy(() => {
		exportRequests.next();
		signOutRequests.next();
	});
</script>

<svelte:head>
	<title>Configurações — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Seu Fichário</p>
		<h1 id="page-title">Configurações</h1>
		<p>Personalize o Fichário, conecte seus arquivos e gerencie sua conta.</p>
	</header>

	{#if signedOut}
		<div class="signed-out" role="status">
			<p>Sessão encerrada.</p>
			{#if error}<p class="signed-out-error">{error}</p>{/if}
			<a href="/login/">Entrar novamente</a>
		</div>
	{:else}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if message}<p class="message" role="status">{message}</p>{/if}

		<ThemePicker />
		<DriveConnectionCard />

		<section class="settings-card" id="privacy" aria-labelledby="privacy-title">
			<div>
				<h2 id="privacy-title">Privacidade</h2>
				<p>
					Seus arquivos e informações ficam vinculados à sua conta e continuam sob seu controle.
				</p>
			</div>
			<a class="secondary-link" href="/library/">Ver meus arquivos</a>
		</section>

		<section class="settings-card" aria-labelledby="export-title">
			<div>
				<h2 id="export-title">Baixar meus dados</h2>
				<p>Salve uma cópia dos seus cadernos e informações do Fichário.</p>
			</div>
			<Button
				label={exporting ? 'Preparando…' : 'Baixar cópia'}
				disabled={exporting || signingOut}
				onclick={() => void exportData()}
			/>
		</section>

		<section class="settings-card" aria-labelledby="originals-title">
			<div>
				<h2 id="originals-title">Arquivos originais</h2>
				<p>
					Quando o Google Drive está conectado, seus arquivos originais ficam disponíveis por lá.
				</p>
			</div>
			<a class="secondary-link" href="/library/">Abrir biblioteca</a>
		</section>

		<section class="settings-card" aria-labelledby="install-title">
			<h2 id="install-title" class="visually-hidden">Instalação</h2>
			<InstallAppButton />
		</section>

		<section class="danger-zone" aria-labelledby="session-title">
			<div>
				<h2 id="session-title">Sua conta</h2>
				<p>Saia do Fichário neste navegador.</p>
			</div>
			<button type="button" disabled={signingOut || exporting} onclick={() => void signOut()}>
				{signingOut ? 'Saindo…' : 'Sair'}
			</button>
		</section>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
	}

	.eyebrow {
		margin-bottom: 0.45rem;
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
		margin-bottom: 0.55rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header p:last-child {
		max-width: 48rem;
		margin-bottom: 0.5rem;
		color: var(--muted);
	}

	.settings-card,
	.danger-zone {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.settings-card h2,
	.danger-zone h2 {
		margin-bottom: 0.35rem;
		font-size: 1.35rem;
	}

	.settings-card p,
	.danger-zone p {
		max-width: 52rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.secondary-link,
	.danger-zone button {
		min-height: 2.55rem;
		display: inline-flex;
		align-items: center;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-weight: 720;
	}

	.danger-zone {
		border-color: rgb(var(--danger-rgb) / 22%);
	}

	.danger-zone button {
		border-color: rgb(var(--danger-rgb) / 35%);
		color: var(--danger);
		cursor: pointer;
	}

	.signed-out {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--archive);
		background: var(--archive-soft);
	}

	.signed-out p {
		margin: 0;
	}

	.signed-out .signed-out-error {
		color: var(--danger);
	}

	.signed-out a {
		min-height: 2.55rem;
		display: inline-flex;
		align-items: center;
		padding: 0.6rem 0.85rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 720;
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

	@media (max-width: 680px) {
		.settings-card,
		.danger-zone {
			grid-template-columns: 1fr;
		}
	}
</style>
