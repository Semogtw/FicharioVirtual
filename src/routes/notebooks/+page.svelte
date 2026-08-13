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
	let parentNotebookId = $state('');
	let loadError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let rootNotebooks = $derived(notebooks.filter((notebook) => notebook.parentNotebookId === null));
	let subNotebooks = $derived(notebooks.filter((notebook) => notebook.parentNotebookId !== null));

	function notebookName(notebookId: string | null) {
		if (!notebookId) return null;
		return notebooks.find((notebook) => notebook.id === notebookId)?.name ?? 'Caderno pai';
	}

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

	function resetForm() {
		name = '';
		description = '';
		parentNotebookId = '';
		createError = null;
	}

	function toggleForm() {
		if (showForm) resetForm();
		showForm = !showForm;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (creating || name.trim().length === 0) return;
		const version = createRequests.next();
		creating = true;
		createError = null;
		try {
			const notebook = await createNotebook({
				name,
				description,
				parentNotebookId: parentNotebookId || null
			});
			if (!createRequests.isCurrent(version)) return;
			notebooks = Object.freeze([
				notebook,
				...notebooks.filter((candidate) => candidate.id !== notebook.id)
			]);
			resetForm();
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
			<p>Agrupe documentos em cadernos e sub-cadernos sem duplicar os arquivos.</p>
		</div>
		<Button
			label={showForm ? 'Fechar' : 'Novo caderno'}
			variant={showForm ? 'secondary' : 'primary'}
			onclick={toggleForm}
		/>
	</header>

	{#if showForm}
		<form class="new-notebook" onsubmit={submit}>
			<div class="fields">
				<label>
					<span>Nome</span>
					<input bind:value={name} maxlength="120" required placeholder="Ex.: Biologia" />
				</label>
				<label class="description-field">
					<span>Descrição opcional</span>
					<textarea
						bind:value={description}
						maxlength="1000"
						rows="1"
						placeholder="Conteúdo, semestre ou finalidade"
					></textarea>
				</label>
				<label>
					<span>Dentro de</span>
					<select bind:value={parentNotebookId}>
						<option value="">Nenhum — caderno principal</option>
						{#each notebooks as candidate (candidate.id)}
							<option value={candidate.id}>{candidate.name}</option>
						{/each}
					</select>
				</label>
			</div>
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
		{#if rootNotebooks.length > 0}
			<section class="notebook-section" aria-labelledby="root-notebooks-title">
				<div class="section-heading">
					<h2 id="root-notebooks-title">Cadernos principais</h2>
					<small>{rootNotebooks.length}</small>
				</div>
				<div class="grid">
					{#each rootNotebooks as notebook (notebook.id)}
						<NotebookCard {notebook} />
					{/each}
				</div>
			</section>
		{/if}

		{#if subNotebooks.length > 0}
			<section class="notebook-section" aria-labelledby="sub-notebooks-title">
				<div class="section-heading">
					<h2 id="sub-notebooks-title">Sub-cadernos</h2>
					<small>{subNotebooks.length}</small>
				</div>
				<div class="grid">
					{#each subNotebooks as notebook (notebook.id)}
						<NotebookCard {notebook} parentName={notebookName(notebook.parentNotebookId)} />
					{/each}
				</div>
			</section>
		{/if}
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

	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 520;
	}

	h1 {
		margin-bottom: 0.55rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	h2 {
		margin: 0;
		font-size: clamp(1.45rem, 3vw, 2rem);
		letter-spacing: -0.025em;
	}

	header p:last-child {
		margin-bottom: 0;
		color: var(--muted);
	}

	.new-notebook {
		display: grid;
		gap: 0.9rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.fields {
		display: grid;
		grid-template-columns: minmax(12rem, 0.9fr) minmax(16rem, 1.3fr) minmax(13rem, 1fr);
		gap: 0.85rem;
		align-items: end;
	}

	label {
		min-width: 0;
		display: grid;
		gap: 0.35rem;
	}

	label span {
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 720;
	}

	input,
	textarea,
	select {
		box-sizing: border-box;
		width: 100%;
		height: 2.85rem;
		min-height: 2.85rem;
		margin: 0;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font: inherit;
		line-height: 1.25;
	}

	textarea {
		overflow: auto;
		resize: none;
	}

	select {
		cursor: pointer;
	}

	.form-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
	}

	.form-error {
		margin: 0 auto 0 0;
		color: var(--danger);
		font-size: 0.75rem;
	}

	.notebook-section {
		display: grid;
		gap: 0.85rem;
	}

	.section-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.section-heading small {
		color: var(--muted);
		font-weight: 720;
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

	@media (max-width: 980px) {
		.fields {
			grid-template-columns: 1fr 1fr;
		}

		.description-field {
			grid-column: span 2;
			grid-row: 2;
		}
	}

	@media (max-width: 620px) {
		header {
			align-items: flex-start;
			flex-direction: column;
		}

		.fields {
			grid-template-columns: 1fr;
		}

		.description-field {
			grid-column: auto;
			grid-row: auto;
		}

		.form-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
