<script lang="ts">
	import { page as appPage } from '$app/state';
	import { onDestroy, onMount, untrack } from 'svelte';
	import SearchMatch from '$lib/components/SearchMatch.svelte';
	import type { PageDetail } from '$lib/domain/page';
	import {
		discardCorrectionDraft,
		readCorrectionDraft,
		writeCorrectionDraft
	} from '$lib/review/draft-index';
	import { createLatestSerialExecutor } from '$lib/review/latest-serial-executor';
	import { savePageCorrection } from '$lib/services/document-detail';
	import { sessionState } from '$lib/stores/session.svelte';
	import { RequestVersion } from '$lib/services/request-version';

	interface CorrectionEditorProps {
		page: PageDetail;
		onSaved?: (page: PageDetail) => void;
	}

	let { page, onSaved }: CorrectionEditorProps = $props();
	let text = $state(untrack(() => page.text));
	let saveState = $state<'idle' | 'draft' | 'saving' | 'saved' | 'error'>('idle');
	let error = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let editVersion = 0;
	let highlightedQuery = $derived(appPage.url.searchParams.get('highlight')?.slice(0, 200) ?? '');

	type SaveRequest = {
		version: number;
		text: string;
		backedUp: boolean;
		draftOwnerUserId: string | null;
	};

	const editorLifecycle = new RequestVersion();
	const lifecycleVersion = editorLifecycle.next();
	const remoteSaves = createLatestSerialExecutor<SaveRequest>(performRemoteSave);

	function storeDraft(draftText = text): string | null {
		const userId = sessionState.user?.id;
		if (!userId) {
			saveState = 'error';
			error = 'Não foi possível associar o rascunho local à sessão atual.';
			return null;
		}
		try {
			writeCorrectionDraft(userId, {
				pageId: page.id,
				text: draftText,
				updatedAt: new Date().toISOString()
			});
			saveState = 'draft';
			error = null;
			return userId;
		} catch {
			saveState = 'error';
			error = 'Não foi possível criar um rascunho local. O salvamento remoto ainda será tentado.';
			return null;
		}
	}

	async function performRemoteSave(request: SaveRequest) {
		try {
			const saved = await savePageCorrection(page.id, request.text);
			if (!editorLifecycle.isCurrent(lifecycleVersion)) return;
			if (request.version !== editVersion) return;
			try {
				if (request.draftOwnerUserId) discardCorrectionDraft(request.draftOwnerUserId, page.id);
				error = null;
			} catch {
				error = 'A correção foi salva no servidor, mas o rascunho local não pôde ser removido.';
			}
			saveState = 'saved';
			onSaved?.(saved);
		} catch {
			if (!editorLifecycle.isCurrent(lifecycleVersion)) return;
			if (request.version !== editVersion) return;
			saveState = 'error';
			error = request.backedUp
				? 'A correção ficou salva neste dispositivo e será reenviada na próxima tentativa.'
				: 'Não foi possível salvar no servidor e o navegador não permitiu criar um rascunho local.';
		}
	}

	async function save(version = editVersion) {
		if (timer) clearTimeout(timer);
		timer = null;
		const snapshot = text;
		const draftOwnerUserId = storeDraft(snapshot);
		const backedUp = draftOwnerUserId !== null;
		saveState = 'saving';
		if (backedUp) error = null;
		await remoteSaves.enqueue({ version, text: snapshot, backedUp, draftOwnerUserId });
	}

	function changed() {
		editVersion += 1;
		storeDraft();
		if (timer) clearTimeout(timer);
		const version = editVersion;
		timer = setTimeout(() => void save(version), 900);
	}

	onMount(() => {
		try {
			const userId = sessionState.user?.id;
			const draft = userId ? readCorrectionDraft(userId, page.id) : null;
			if (draft && Date.parse(draft.updatedAt) > Date.parse(page.updatedAt)) {
				text = draft.text;
				saveState = 'draft';
			}
		} catch {
			saveState = 'error';
			error =
				'Não foi possível recuperar o rascunho local. O editor e o salvamento remoto continuam disponíveis.';
		}
	});

	onDestroy(() => {
		editorLifecycle.next();
		if (timer) clearTimeout(timer);
	});
</script>

<section class="editor" aria-labelledby={`editor-title-${page.id}`}>
	<div class="heading">
		<div>
			<p>Página {page.pageNumber}</p>
			<h2 id={`editor-title-${page.id}`}>Transcrição e correção</h2>
		</div>
		<span class:problem={saveState === 'error'} role="status">
			{saveState === 'saving'
				? 'Salvando…'
				: saveState === 'saved'
					? 'Salvo'
					: saveState === 'draft'
						? 'Rascunho local'
						: saveState === 'error'
							? 'Pendente'
							: ''}
		</span>
	</div>

	{#if page.warnings.length > 0}
		<ul class="warnings" aria-label="Avisos da transcrição">
			{#each page.warnings as warning}
				<li>{warning.message}</li>
			{/each}
		</ul>
	{/if}

	{#if highlightedQuery}
		<SearchMatch
			text={text}
			query={highlightedQuery}
			label="Trecho encontrado nesta página"
			maximumLength={320}
		/>
	{/if}

	<label>
		<span class="visually-hidden">Texto corrigido da página {page.pageNumber}</span>
		<textarea bind:value={text} oninput={changed} maxlength="1000000" spellcheck="true"></textarea>
	</label>

	<div class="footer">
		<div>
			<span>{text.length.toLocaleString('pt-BR')} caracteres</span>
			{#if error}<p role="alert">{error}</p>{/if}
		</div>
		<button type="button" onclick={() => void save()} disabled={saveState === 'saving'}>
			Salvar agora
		</button>
	</div>
</section>

<style>
	.editor {
		display: grid;
		gap: 0.8rem;
		min-height: 34rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.heading,
	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.heading p {
		margin-bottom: 0.15rem;
		color: var(--archive);
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		font-family: var(--font-heading);
		font-size: 1.45rem;
		font-weight: 560;
	}

	.heading > span {
		color: var(--archive);
		font-size: 0.76rem;
		font-weight: 700;
	}

	.heading > span.problem {
		color: var(--danger);
	}

	.warnings {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0.75rem 0.75rem 0.75rem 2rem;
		border-left: 0.25rem solid var(--accent);
		background: rgb(166 94 67 / 7%);
		color: var(--accent-strong);
		font-size: 0.82rem;
	}

	label,
	textarea {
		width: 100%;
		height: 100%;
	}

	textarea {
		min-height: 25rem;
		padding: 1rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-family: var(--font-body);
		font-size: 1rem;
		line-height: 1.7;
		resize: vertical;
	}

	.footer {
		align-items: flex-end;
	}

	.footer span {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.footer p {
		max-width: 38rem;
		margin: 0.3rem 0 0;
		color: var(--danger);
		font-size: 0.78rem;
	}

	button {
		min-height: 2.55rem;
		padding: 0.6rem 0.85rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 740;
		cursor: pointer;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.65;
	}
</style>
