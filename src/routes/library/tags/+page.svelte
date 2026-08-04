<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { DocumentSummary } from '$lib/domain/document';
	import { listAllDocuments } from '$lib/services/documents';
	import { RequestVersion } from '$lib/services/request-version';
	import {
		createTag,
		deleteTag,
		listTagDocumentIds,
		listTags,
		renameTag,
		setTagMembership,
		type TagSummary
	} from '$lib/services/tags';

	const assignmentRequests = new RequestVersion();
	let tags = $state<readonly TagSummary[]>([]);
	let documents = $state<readonly DocumentSummary[]>([]);
	let activeTagId = $state<string | null>(null);
	let assignedDocumentIds = $state<ReadonlySet<string>>(new Set());
	let newTagName = $state('');
	let loading = $state(true);
	let initialized = $state(false);
	let loadingAssignments = $state(false);
	let assignmentsReady = $state(false);
	let saving = $state(false);
	let pendingDocumentId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let assignmentError = $state<string | null>(null);
	let message = $state<string | null>(null);

	let activeTag = $derived(tags.find((tag) => tag.id === activeTagId) ?? null);

	async function refreshTags(preferredId: string | null = activeTagId) {
		tags = await listTags();
		const nextId = tags.some((tag) => tag.id === preferredId) ? preferredId : (tags[0]?.id ?? null);
		activeTagId = nextId;
		if (nextId) await loadAssignments(nextId);
		else {
			assignmentRequests.next();
			assignedDocumentIds = new Set();
			loadingAssignments = false;
			assignmentsReady = false;
			assignmentError = null;
		}
	}

	async function loadAssignments(tagId: string, version = assignmentRequests.next()) {
		loadingAssignments = true;
		assignmentsReady = false;
		assignmentError = null;
		try {
			const loadedAssignments = await listTagDocumentIds(tagId);
			if (!assignmentRequests.isCurrent(version) || activeTagId !== tagId) return;
			assignedDocumentIds = loadedAssignments;
			assignmentsReady = true;
		} catch (caught) {
			if (assignmentRequests.isCurrent(version) && activeTagId === tagId) {
				assignmentsReady = false;
				assignmentError =
					caught instanceof Error
						? caught.message
						: 'Não foi possível carregar os documentos da tag.';
			}
		} finally {
			if (assignmentRequests.isCurrent(version) && activeTagId === tagId) {
				loadingAssignments = false;
			}
		}
	}

	async function initialize() {
		loading = true;
		initialized = false;
		assignmentsReady = false;
		assignmentError = null;
		error = null;
		try {
			const [loadedTags, loadedDocuments] = await Promise.all([listTags(), listAllDocuments()]);
			tags = loadedTags;
			documents = loadedDocuments;
			activeTagId = tags[0]?.id ?? null;
			initialized = true;
			if (activeTagId) await loadAssignments(activeTagId);
		} catch (caught) {
			initialized = false;
			error = caught instanceof Error ? caught.message : 'Não foi possível abrir as tags.';
		} finally {
			loading = false;
		}
	}

	async function addTag() {
		if (!initialized || saving || !newTagName.trim()) return;
		saving = true;
		error = null;
		message = null;
		try {
			const tagId = await createTag(newTagName);
			newTagName = '';
			await refreshTags(tagId);
			message = 'Tag criada.';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível criar a tag.';
		} finally {
			saving = false;
		}
	}

	async function renameActiveTag() {
		if (!activeTag || saving) return;
		const requested = window.prompt('Novo nome da tag', activeTag.name);
		if (requested === null || requested.trim() === activeTag.name) return;
		saving = true;
		error = null;
		try {
			await renameTag(activeTag.id, requested);
			await refreshTags(activeTag.id);
			message = 'Tag renomeada.';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível renomear a tag.';
		} finally {
			saving = false;
		}
	}

	async function removeActiveTag() {
		if (!activeTag || saving) return;
		if (!window.confirm(`Excluir a tag “${activeTag.name}”? Os documentos não serão apagados.`))
			return;
		saving = true;
		error = null;
		try {
			await deleteTag(activeTag.id);
			await refreshTags(null);
			message = 'Tag excluída.';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível excluir a tag.';
		} finally {
			saving = false;
		}
	}

	async function toggleDocument(documentId: string, assigned: boolean) {
		if (!activeTag || !assignmentsReady || pendingDocumentId) return;
		const tagId = activeTag.id;
		pendingDocumentId = documentId;
		error = null;
		try {
			await setTagMembership(tagId, documentId, assigned);
			if (activeTagId !== tagId) return;
			const next = new Set(assignedDocumentIds);
			if (assigned) next.add(documentId);
			else next.delete(documentId);
			assignedDocumentIds = next;
			tags = tags.map((tag) =>
				tag.id === tagId
					? Object.freeze({
							...tag,
							documentCount: Math.max(0, tag.documentCount + (assigned ? 1 : -1))
						})
					: tag
			);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível atualizar a tag.';
		} finally {
			pendingDocumentId = null;
		}
	}

	onMount(() => {
		void initialize();
	});

	onDestroy(() => {
		assignmentRequests.next();
	});
</script>

<svelte:head>
	<title>Tags — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Organização transversal</p>
			<h1 id="page-title">Tags</h1>
			<p>Associe o mesmo documento a temas diferentes sem duplicar arquivos ou páginas.</p>
		</div>
	</header>

	<form
		class="create-form"
		onsubmit={(event) => {
			event.preventDefault();
			void addTag();
		}}
	>
		<label>
			<span class="visually-hidden">Nome da nova tag</span>
			<input bind:value={newTagName} maxlength="120" placeholder="Nova tag, ex.: Citologia" />
		</label>
		<Button
			label={saving ? 'Salvando…' : 'Criar tag'}
			disabled={!initialized || saving || !newTagName.trim()}
			type="submit"
		/>
	</form>

	{#if error}
		<div class="error" role="alert">
			<p>{error}</p>
			{#if !initialized}
				<Button label="Tentar novamente" variant="secondary" onclick={() => void initialize()} />
			{/if}
		</div>
	{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	{#if loading}
		<p class="loading" role="status">Carregando tags e documentos…</p>
	{:else if tags.length === 0}
		<EmptyState
			title="Nenhuma tag criada"
			description="Crie uma tag para organizar documentos por tema, disciplina ou etapa de estudo."
		/>
	{:else}
		<div class="workspace">
			<aside aria-label="Tags disponíveis">
				<ul>
					{#each tags as tag (tag.id)}
						<li>
							<button
								type="button"
								class:active={tag.id === activeTagId}
								disabled={saving || loadingAssignments || pendingDocumentId !== null}
								onclick={() => {
									activeTagId = tag.id;
									void loadAssignments(tag.id);
								}}
							>
								<span>{tag.name}</span>
								<small>{tag.documentCount}</small>
							</button>
						</li>
					{/each}
				</ul>
			</aside>

			<section class="assignment" aria-labelledby="assignment-title">
				<div class="assignment-heading">
					<div>
						<p class="eyebrow">Tag selecionada</p>
						<h2 id="assignment-title">{activeTag?.name}</h2>
					</div>
					<div class="tag-actions">
						<button type="button" disabled={saving} onclick={() => void renameActiveTag()}
							>Renomear</button
						>
						<button
							class="danger"
							type="button"
							disabled={saving}
							onclick={() => void removeActiveTag()}
						>
							Excluir
						</button>
					</div>
				</div>

				{#if loadingAssignments}
					<p class="loading">Verificando associações…</p>
				{:else if assignmentError && activeTag}
					<div class="assignment-error" role="alert">
						<p>{assignmentError}</p>
						<button type="button" onclick={() => void loadAssignments(activeTag.id)}>
							Tentar novamente
						</button>
					</div>
				{:else if documents.length === 0}
					<EmptyState
						title="Biblioteca vazia"
						description="Importe documentos antes de associá-los a uma tag."
					/>
				{:else}
					<ul class="documents">
						{#each documents as document (document.id)}
							<li>
								<label>
									<input
										type="checkbox"
										checked={assignedDocumentIds.has(document.id)}
										disabled={!assignmentsReady || pendingDocumentId !== null}
										onchange={(event) =>
											void toggleDocument(
												document.id,
												(event.currentTarget as HTMLInputElement).checked
											)}
									/>
									<span>
										<strong>{document.title}</strong>
										<small>{document.kind === 'pdf' ? 'PDF' : 'Imagem'} · {document.status}</small>
									</span>
								</label>
								<a href={`/documents/${document.id}/`}>Abrir</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
	}

	.eyebrow {
		margin-bottom: 0.4rem;
		color: var(--archive);
		font-size: 0.73rem;
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
		margin: 0;
		color: var(--muted);
	}

	.create-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.65rem;
		max-width: 42rem;
	}

	.create-form input {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(12rem, 0.28fr) minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}

	aside,
	.assignment {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	aside ul,
	.documents {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	aside {
		padding: 0.45rem;
	}

	aside button {
		width: 100%;
		min-height: 2.7rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.55rem 0.7rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}

	aside button.active {
		background: var(--archive-soft);
		color: var(--archive);
		font-weight: 740;
	}

	aside small {
		min-width: 1.65rem;
		padding: 0.15rem 0.35rem;
		border-radius: 99rem;
		background: var(--paper);
		text-align: center;
	}

	.assignment {
		display: grid;
		gap: 0.8rem;
		padding: 1rem;
	}

	.assignment-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}

	.assignment-heading h2 {
		margin: 0;
		font-size: 1.8rem;
	}

	.tag-actions {
		display: flex;
		gap: 0.45rem;
	}

	.tag-actions button,
	.documents a {
		min-height: 2.35rem;
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-size: 0.76rem;
		font-weight: 720;
		cursor: pointer;
	}

	.tag-actions button.danger {
		color: var(--danger);
	}

	.documents {
		display: grid;
		gap: 0.45rem;
	}

	.documents li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	.documents label {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		cursor: pointer;
	}

	.documents input {
		width: 1.1rem;
		height: 1.1rem;
		flex: 0 0 auto;
	}

	.documents label span {
		min-width: 0;
		display: grid;
		gap: 0.15rem;
	}

	.documents strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.documents small {
		color: var(--muted);
	}

	.loading {
		padding: 2rem;
		color: var(--muted);
		text-align: center;
	}

	.error,
	.message {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
	}

	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.error p {
		margin: 0;
	}

	.assignment-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0.9rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
	}

	.assignment-error p {
		margin: 0;
	}

	.assignment-error button {
		min-height: 2.35rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		font-size: 0.76rem;
		font-weight: 720;
		cursor: pointer;
	}

	.message {
		border-color: var(--archive);
		background: var(--archive-soft);
		color: var(--archive);
	}

	@media (max-width: 780px) {
		.workspace {
			grid-template-columns: 1fr;
		}

		aside ul {
			display: flex;
			overflow-x: auto;
		}

		aside li {
			min-width: 10rem;
		}
	}

	@media (max-width: 560px) {
		.create-form {
			grid-template-columns: 1fr;
		}

		.assignment-heading,
		.documents li {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
