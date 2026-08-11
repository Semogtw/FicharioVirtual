<script lang="ts">
	import { onMount } from 'svelte';

	const storageKey = 'fichario:data-processing-notice:v1';
	let visible = $state(false);

	onMount(() => {
		try {
			if (globalThis.localStorage.getItem(storageKey) === 'seen') return;
			globalThis.localStorage.setItem(storageKey, 'seen');
		} catch {
			// O aviso continua informativo mesmo quando o armazenamento local está indisponível.
		}
		visible = true;
	});
</script>

{#if visible}
	<section class="notice" aria-label="Privacidade e processamento de dados">
		<div>
			<strong>Processamento privado, sem confirmações repetidas</strong>
			<p>
				OCR e recursos de IA podem processar somente o conteúdo necessário quando você os usa. Esta
				mensagem aparece uma vez neste navegador; os detalhes ficam sempre em
				<a href="/settings/#privacy">Configurações → Privacidade e dados</a>.
			</p>
		</div>
		<button type="button" aria-label="Fechar aviso" onclick={() => (visible = false)}>×</button>
	</section>
{/if}

<style>
	.notice {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin: 0.9rem 1rem 0;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--line);
		border-left: 0.25rem solid var(--archive);
		border-radius: var(--radius-sm);
		background: var(--archive-soft);
	}

	.notice > div {
		display: grid;
		gap: 0.2rem;
	}

	.notice strong {
		font-size: 0.88rem;
	}

	.notice p {
		max-width: 60rem;
		margin: 0;
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.45;
	}

	.notice a {
		color: var(--archive);
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.notice button {
		width: 2rem;
		height: 2rem;
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 1.25rem;
		cursor: pointer;
	}

	.notice button:hover {
		background: rgb(var(--line-rgb) / 42%);
		color: var(--ink);
	}

	@media (min-width: 768px) {
		.notice {
			margin-inline: clamp(1.25rem, 3vw, 2.5rem);
		}
	}
</style>
