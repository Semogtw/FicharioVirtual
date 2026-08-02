<script lang="ts">
	import { onMount } from 'svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { discardCorrectionDraft, listCorrectionDrafts } from '$lib/review/draft-index';
	import type { CorrectionDraft } from '$lib/review/drafts';
	import { resolveDraftLocations, type DraftLocation } from '$lib/services/draft-locations';

	type DraftRow = {
		draft: CorrectionDraft;
		location: DraftLocation | null;
	};

	let rows = $state<readonly DraftRow[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function refresh() {
		loading = true;
		error = null;
		try {
			const drafts = listCorrectionDrafts();
			const locations = await resolveDraftLocations(drafts.map((draft) => draft.pageId));
			const byPage = new Map(locations.map((location) => [location.pageId, location] as const));
			rows = Object.freeze(
				drafts.map((draft) => Object.freeze({ draft, location: byPage.get(draft.pageId) ?? null }))
			);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível carregar os rascunhos.';
		} finally {
			loading = false;
		}
	}

	function discard(pageId: string) {
		if (!window.confirm('Descartar somente este rascunho local? O texto remoto não será alterado.'))
			return;
		discardCorrectionDraft(pageId);
		rows = rows.filter((row) => row.draft.pageId !== pageId);
	}

	onMount(() => {
		void refresh();
	});
</script>

<svelte:head>
	<title>Rascunhos locais — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<p class="eyebrow">Recuperação no dispositivo</p>
		<h1 id="page-title">Rascunhos locais</h1>
		<p>
			Correções ainda não confirmadas no servidor ficam limitadas e isoladas por página neste
			navegador.
		</p>
	</header>

	{#if loading}
		<p class="loading" role="status">Localizando rascunhos…</p>
	{:else if error}
		<div class="error" role="alert">
			<p>{error}</p>
			<button type="button" onclick={() => void refresh()}>Tentar novamente</button>
		</div>
	{:else if rows.length === 0}
		<EmptyState
			title="Nenhum rascunho local"
			description="Quando uma correção não conseguir sincronizar, ela aparecerá aqui até ser salva ou descartada."
		/>
	{:else}
		<section class="drafts" aria-label="Rascunhos de correção">
			{#each rows as row (row.draft.pageId)}
				<article>
					<div class="copy">
						<p class="eyebrow">
							Atualizado {new Date(row.draft.updatedAt).toLocaleString('pt-BR')}
						</p>
						<h2>{row.location?.documentTitle ?? 'Página não encontrada no servidor'}</h2>
						{#if row.location}
							<p>
								Página {row.location.pageNumber} · {row.draft.text.length.toLocaleString('pt-BR')} caracteres
							</p>
							{#if Date.parse(row.draft.updatedAt) <= Date.parse(row.location.pageUpdatedAt)}
								<span class="notice"
									>O servidor possui uma versão igual ou mais recente; revise antes de salvar.</span
								>
							{/if}
						{:else}
							<p>O documento pode ter sido excluído ou o acesso não está mais disponível.</p>
						{/if}
						<pre>{row.draft.text.slice(0, 600)}{row.draft.text.length > 600 ? '…' : ''}</pre>
					</div>
					<div class="actions">
						{#if row.location}
							<a href={`/documents/${row.location.documentId}/?page=${row.location.pageNumber}`}>
								Retomar no editor
							</a>
						{/if}
						<button type="button" class="danger" onclick={() => discard(row.draft.pageId)}>
							Descartar local
						</button>
					</div>
				</article>
			{/each}
		</section>
	{/if}
</div>

<style>
	.page,
	.drafts {
		display: grid;
		gap: 1rem;
	}

	.eyebrow {
		margin-bottom: 0.4rem;
		color: var(--archive);
		font-size: 0.72rem;
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
		margin-bottom: 0.55rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header p:last-child {
		max-width: 50rem;
		margin: 0;
		color: var(--muted);
	}

	article {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.copy {
		min-width: 0;
	}

	h2 {
		margin-bottom: 0.3rem;
		font-size: 1.35rem;
	}

	.copy > p:not(.eyebrow) {
		margin: 0 0 0.6rem;
		color: var(--muted);
	}

	.notice {
		display: block;
		margin-bottom: 0.6rem;
		color: var(--accent-strong);
		font-size: 0.78rem;
		font-weight: 700;
	}

	pre {
		max-height: 11rem;
		overflow: auto;
		margin: 0;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--paper);
		color: #444b47;
		font-family: var(--font-body);
		font-size: 0.82rem;
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.45rem;
	}

	.actions a,
	.actions button,
	.error button {
		min-height: 2.45rem;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 720;
		cursor: pointer;
	}

	.actions a {
		border-color: var(--archive);
		background: var(--archive);
		color: white;
	}

	.actions .danger {
		color: var(--danger);
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

	@media (max-width: 700px) {
		article {
			grid-template-columns: 1fr;
		}

		.actions {
			justify-content: flex-start;
		}
	}
</style>
