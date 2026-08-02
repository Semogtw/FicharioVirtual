<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	type InstallPromptEvent = Event & {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	};

	let promptEvent = $state<InstallPromptEvent | null>(null);
	let installed = $state(false);
	let message = $state<string | null>(null);

	function capture(event: Event) {
		event.preventDefault();
		promptEvent = event as InstallPromptEvent;
	}

	function markInstalled() {
		installed = true;
		promptEvent = null;
		message = 'Aplicativo instalado neste dispositivo.';
	}

	async function install() {
		if (!promptEvent) return;
		await promptEvent.prompt();
		const choice = await promptEvent.userChoice;
		if (choice.outcome === 'accepted') markInstalled();
		else message = 'A instalação foi cancelada.';
	}

	onMount(() => {
		installed = window.matchMedia('(display-mode: standalone)').matches;
		window.addEventListener('beforeinstallprompt', capture);
		window.addEventListener('appinstalled', markInstalled);
	});

	onDestroy(() => {
		window.removeEventListener('beforeinstallprompt', capture);
		window.removeEventListener('appinstalled', markInstalled);
	});
</script>

<div class="install-card">
	<div>
		<strong>Aplicativo instalável</strong>
		<p>
			O PWA guarda apenas o shell e ativos públicos. Documentos privados continuam vindo da sessão
			autenticada.
		</p>
	</div>
	{#if installed}
		<span>Instalado</span>
	{:else if promptEvent}
		<button type="button" onclick={() => void install()}>Instalar</button>
	{:else}
		<span>Use “Adicionar à tela inicial” no menu do navegador.</span>
	{/if}
	{#if message}<small role="status">{message}</small>{/if}
</div>

<style>
	.install-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.8rem 1rem;
	}

	strong {
		display: block;
		margin-bottom: 0.25rem;
		font-family: var(--font-heading);
		font-size: 1.25rem;
		font-weight: 560;
	}

	p {
		margin: 0;
		color: var(--muted);
		line-height: 1.5;
	}

	button,
	.install-card > span {
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 720;
	}

	button {
		background: var(--archive);
		color: white;
		cursor: pointer;
	}

	small {
		grid-column: 1 / -1;
		color: var(--muted);
	}

	@media (max-width: 620px) {
		.install-card {
			grid-template-columns: 1fr;
		}
	}
</style>
