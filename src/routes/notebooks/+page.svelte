<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import NotebookCard from '$lib/components/NotebookCard.svelte';
	import type { NotebookSummary } from '$lib/domain/notebook';
	import { createNotebook, listNotebooks } from '$lib/services/notebooks';
	import { RequestVersion } from '$lib/services/request-version';

	const refreshRequests = new RequestVersion();
	const createRequests = new RequestVersion();
	let notebooks = $state<readonly NotebookSummary[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let showForm = $state(false);
	let name = $state('');
	let description = $state('');
	let loadError = $state<string | null>(null);
	let createError = $state<string | null>(null);

	async function refresh(version = refreshRequests.next()) {
		loading = true;
		loadError = null;
		try {
			const loaded = await listNotebooks();
			if (!refreshRequests.isCurrent(version)) return;
			notebooks = loaded;
		} catch {
			if (refreshRequests.isCurrent(version)) {
				loadError = 'Não foi possível carregar os cadernos agora.';
			}
		} finally {
			if (refreshRequests.isCurrent(version)) loading = false;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (creating || name.trim().length === 0) return;
		const version = createRequests.next();
		creating = true;
		createError = null;
		try {
			const notebook = await createNotebook({ name, description });
			if (!createRequests.isCurrent(version)) return;
			notebooks = Object.freeze([
				notebook,
				...notebooks.filter((candidate) => candidate.id !== notebook.id)
			]);
			name = '';
			description = '';
			showForm = false;
			await refresh();
		} catch {
			if (createRequests.isCurrent(version)) {
				createError = 'Não foi possível criar o caderno.';
			}
		} finally {
			if (createRequests.isCurrent(version)) creating = false;
		}
	}

	onMount(() => {
		void refresh();
	});

	onDestroy(() => {
		refreshRequests.next();
		createRequests.next();
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
			<div class="form-actions">
				{#if createError}<p class="form-error" role="alert">{createError}</p>{/if}
				<Button label={creating ? 'Criando…' : 'Criar caderno'} type="submit" disabled={creating} />
			</div>
		</form>
	{/if}

	{#if loadError}
		<div class="error" role="alert">
			<p>{loadError}</p>
			<Button label="Tentar novamente" variant="secondary" onclick={() => void refresh()} />
		</div>
	{/if}

	{#if loading && notebooks.length === 0}
		<p class="loading" role="status">Abrindo seus cadernos…</p>
	{:else if notebooks.length === 0}
		{#if !loadError}
			<EmptyState
				title="Nenhum caderno criado"
				description="Crie um caderno para reunir documentos por matéria, projeto ou período."
				actionLabel="Criar primeiro caderno"
				onAction={() => (showForm = true)}
			/>
		{/if}
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

	.form-actions {
		display: grid;
		gap: 0.4rem;
		align-items: end;
	}

	.form-error {
		max-width: 16rem;
		margin: 0;
		color: var(--danger);
		font-size: 0.75rem;
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
