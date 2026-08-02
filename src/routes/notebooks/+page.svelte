<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import NotebookCard from '$lib/components/NotebookCard.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { createNotebook, listNotebooks } from '$lib/services/notebooks';

	let notebooks = $state<readonly NotebookSummary[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let showForm = $state(false);
	let name = $state('');
	let description = $state('');
	let error = $state<string | null>(null);

	async function refresh() {
		loading = true;
		error = null;
		try {
			notebooks = await listNotebooks();
		} catch {
			error = 'Não foi possível carregar os cadernos agora.';
		} finally {
			loading = false;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (creating || name.trim().length === 0) return;
		creating = true;
		error = null;
		try {
			const notebook = await createNotebook({ name, description });
			notebooks = Object.freeze([notebook, ...notebooks]);
			name = '';
			description = '';
			showForm = false;
		} catch {
			error = 'Não foi possível criar o caderno.';
		} finally {
			creating = false;
		}
	}

	onMount(() => {
		void refresh();
	});
</script>

<svelte:head>
	<title>Cadernos — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Organização</p>
			<h1 id="page-title">Cadernos</h1>
			<p>Agrupe documentos sem duplicar arquivos ou transcrições.</p>
		</div>
		<Button
			label={showForm ? 'Fechar' : 'Novo caderno'}
			variant={showForm ? 'secondary' : 'primary'}
			onclick={() => (showForm = !showForm)}
		/>
	</header>

	{#if showForm}
		<form class="new-notebook" onsubmit={submit}>
			<label>
				<span>Nome</span>
				<input bind:value={name} maxlength="120" required placeholder="Ex.: Biologia" />
			</label>
			<label>
				<span>Descrição opcional</span>
				<textarea
					bind:value={description}
					maxlength="1000"
					rows="3"
					placeholder="Conteúdo, semestre ou finalidade"
				></textarea>
			</label>
			<Button label={creating ? 'Criando…' : 'Criar caderno'} type="submit" disabled={creating} />
		</form>
	{/if}

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void refresh()} />
		</div>
	{:else if loading}
		<p class="loading" role="status">Abrindo seus cadernos…</p>
	{:else if notebooks.length === 0}
		<EmptyState
			title="Nenhum caderno criado"
			description="Crie um caderno para reunir documentos por matéria, projeto ou período."
			actionLabel="Criar primeiro caderno"
			onAction={() => (showForm = true)}
		/>
	{:else}
		<section class="grid" aria-label="Cadernos">
			{#each notebooks as notebook (notebook.id)}
				<NotebookCard {notebook} />
			{/each}
		</section>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1.5rem;
	}

	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.5rem;
	}

	.eyebrow {
		margin-bottom: 0.45rem;
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-family: var(--font-heading);
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		font-weight: 520;
		letter-spacing: -0.04em;
	}

	header p:last-child {
		margin-bottom: 0;
		color: var(--muted);
	}

	.new-notebook {
		display: grid;
		grid-template-columns: minmax(12rem, 0.75fr) minmax(16rem, 1.25fr) auto;
		align-items: end;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	label {
		display: grid;
		gap: 0.35rem;
	}

	label span {
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 720;
	}

	input,
	textarea {
		width: 100%;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		resize: vertical;
	}

	input {
		min-height: 2.75rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 1rem;
	}

	.loading {
		padding: 3rem;
		color: var(--muted);
		text-align: center;
	}

	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
	}

	.error p {
		margin: 0;
		color: var(--danger);
	}

	@media (max-width: 820px) {
		.new-notebook {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
