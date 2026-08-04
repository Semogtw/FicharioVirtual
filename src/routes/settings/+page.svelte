<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import InstallAppButton from '$lib/components/InstallAppButton.svelte';
	import { createPortableExport, downloadPortableExport } from '$lib/services/export';
	import { endSession, sessionState } from '$lib/stores/session.svelte';

	let exporting = $state(false);
	let signingOut = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function exportData() {
		if (exporting || signingOut) return;
		exporting = true;
		error = null;
		message = null;
		try {
			const manifest = await createPortableExport();
			downloadPortableExport(manifest);
			message = `${manifest.documents.length} documentos e ${manifest.notebooks.length} cadernos exportados.`;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível gerar a exportação.';
		} finally {
			exporting = false;
		}
	}

	async function signOut() {
		if (signingOut || exporting) return;
		signingOut = true;
		error = null;
		message = null;
		try {
			await endSession();
			await goto('/login/');
		} catch {
			error = sessionState.error ?? 'Não foi possível encerrar a sessão agora.';
		} finally {
			signingOut = false;
		}
	}
</script>

<svelte:head>
	<title>Configurações — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Conta e propriedade dos dados</p>
		<h1 id="page-title">Configurações</h1>
		<p>Controle exportação, instalação e sessão sem expor chaves ou caminhos privados.</p>
	</header>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	<section class="settings-card" aria-labelledby="export-title">
		<div>
			<h2 id="export-title">Exportação portátil</h2>
			<p>
				Baixe um JSON versionado com cadernos, metadados, tags, fontes de texto, correções e avisos.
				Caminhos privados, tokens e URLs assinadas não entram no arquivo.
			</p>
		</div>
		<Button
			label={exporting ? 'Gerando…' : 'Exportar catálogo JSON'}
			disabled={exporting || signingOut}
			onclick={() => void exportData()}
		/>
	</section>

	<section class="settings-card" aria-labelledby="originals-title">
		<div>
			<h2 id="originals-title">Arquivos originais</h2>
			<p>
				Cada documento oferece um link assinado de curta duração para o original. Isso evita criar
				um arquivo público ou uma URL permanente durante a exportação.
			</p>
		</div>
		<a class="secondary-link" href="/library/">Abrir biblioteca</a>
	</section>

	<section class="settings-card" aria-labelledby="install-title">
		<h2 id="install-title" class="visually-hidden">Instalação</h2>
		<InstallAppButton />
	</section>

	<section class="policy" aria-labelledby="policy-title">
		<h2 id="policy-title">Política operacional</h2>
		<ul>
			<li>Nenhuma cobrança é ativada automaticamente.</li>
			<li>A leitura externa exige consentimento e usa limite diário configurado no backend.</li>
			<li>
				Quando a cota termina, páginas ficam pendentes em vez de trocar silenciosamente de modelo.
			</li>
			<li>O service worker não guarda respostas autenticadas, documentos ou transcrições.</li>
		</ul>
	</section>

	<section class="danger-zone" aria-labelledby="session-title">
		<div>
			<h2 id="session-title">Sessão atual</h2>
			<p>Encerre o acesso neste navegador. Os documentos permanecem no arquivo privado.</p>
		</div>
		<button type="button" disabled={signingOut || exporting} onclick={() => void signOut()}>
			{signingOut ? 'Saindo…' : 'Sair'}
		</button>
	</section>
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
	.danger-zone h2,
	.policy h2 {
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

	.policy {
		padding: 1rem;
		border-left: 0.3rem solid var(--archive);
		background: var(--archive-soft);
	}

	.policy ul {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding-left: 1.2rem;
		color: #46504a;
		line-height: 1.5;
	}

	.danger-zone {
		border-color: rgb(155 63 54 / 22%);
	}

	.danger-zone button {
		border-color: rgb(155 63 54 / 35%);
		color: var(--danger);
		cursor: pointer;
	}

	.error,
	.message {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
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
