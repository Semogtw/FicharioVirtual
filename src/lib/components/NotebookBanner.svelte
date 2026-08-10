<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		createNotebookBannerUrl,
		NotebookBannerError,
		removeNotebookBanner,
		saveNotebookBanner,
		validateNotebookBannerFile
	} from '$lib/services/notebook-banners';

	interface NotebookBannerProps {
		notebookId: string;
		bannerPath: string | null;
		bannerPositionX: number;
		bannerPositionY: number;
	}

	let { notebookId, bannerPath, bannerPositionX, bannerPositionY }: NotebookBannerProps = $props();

	let renderedPath = $state<string | null>(null);
	let renderedPositionX = $state(50);
	let renderedPositionY = $state(50);
	let renderedUrl = $state<string | null>(null);
	let editorOpen = $state(false);
	let selectedFile = $state<File | null>(null);
	let previewUrl = $state<string | null>(null);
	let positionX = $state(50);
	let positionY = $state(50);
	let loadingUrl = $state(false);
	let saving = $state(false);
	let removing = $state(false);
	let error = $state<string | null>(null);
	let urlRequest = 0;

	function revokePreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
	}

	async function refreshSignedUrl(path: string | null) {
		const request = ++urlRequest;
		if (!path) {
			renderedUrl = null;
			loadingUrl = false;
			return;
		}
		loadingUrl = true;
		try {
			const url = await createNotebookBannerUrl(path);
			if (request === urlRequest) renderedUrl = url;
		} catch {
			if (request === urlRequest) renderedUrl = null;
		} finally {
			if (request === urlRequest) loadingUrl = false;
		}
	}

	function openEditor() {
		positionX = renderedPositionX;
		positionY = renderedPositionY;
		error = null;
		editorOpen = true;
	}

	function closeEditor() {
		if (saving || removing) return;
		revokePreview();
		selectedFile = null;
		positionX = renderedPositionX;
		positionY = renderedPositionY;
		error = null;
		editorOpen = false;
	}

	function selectFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		revokePreview();
		selectedFile = null;
		error = null;
		if (!file) return;
		try {
			validateNotebookBannerFile(file);
			selectedFile = file;
			previewUrl = URL.createObjectURL(file);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Não foi possível usar esta imagem.';
			input.value = '';
		}
	}

	async function save() {
		if (saving || removing) return;
		saving = true;
		error = null;
		try {
			const result = await saveNotebookBanner(notebookId, {
				file: selectedFile,
				positionX,
				positionY
			});
			renderedPath = result.bannerPath;
			renderedPositionX = result.positionX;
			renderedPositionY = result.positionY;
			await refreshSignedUrl(result.bannerPath);
			revokePreview();
			selectedFile = null;
			editorOpen = false;
		} catch (cause) {
			error =
				cause instanceof NotebookBannerError || cause instanceof Error
					? cause.message
					: 'Não foi possível salvar o banner agora.';
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (saving || removing || !renderedPath) return;
		removing = true;
		error = null;
		try {
			await removeNotebookBanner(notebookId);
			renderedPath = null;
			renderedPositionX = 50;
			renderedPositionY = 50;
			positionX = 50;
			positionY = 50;
			renderedUrl = null;
			revokePreview();
			selectedFile = null;
			editorOpen = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Não foi possível remover o banner agora.';
		} finally {
			removing = false;
		}
	}

	$effect(() => {
		const incomingNotebookId = notebookId;
		const incomingPath = bannerPath;
		const incomingPositionX = bannerPositionX;
		const incomingPositionY = bannerPositionY;
		void incomingNotebookId;
		renderedPath = incomingPath;
		renderedPositionX = incomingPositionX;
		renderedPositionY = incomingPositionY;
		void refreshSignedUrl(incomingPath);
	});

	onDestroy(() => {
		urlRequest += 1;
		revokePreview();
	});
</script>

<div class="banner-shell">
	{#if renderedPath}
		<div class="banner" aria-busy={loadingUrl}>
			{#if renderedUrl}
				<img
					src={renderedUrl}
					alt=""
					style:object-position={`${renderedPositionX}% ${renderedPositionY}%`}
				/>
			{:else}
				<div class="banner-fallback" aria-hidden="true"></div>
			{/if}
			<div class="banner-shade" aria-hidden="true"></div>
			<button class="edit-banner" type="button" onclick={openEditor}>Personalizar banner</button>
		</div>
	{:else if !editorOpen}
		<div class="add-banner-row">
			<button class="add-banner" type="button" onclick={openEditor}>+ Adicionar banner</button>
		</div>
	{/if}

	{#if editorOpen}
		<section class="editor" aria-labelledby="banner-editor-title">
			<div class="editor-heading">
				<div>
					<p class="eyebrow">Aparência do caderno</p>
					<h2 id="banner-editor-title">Personalizar banner</h2>
				</div>
				<button class="close" type="button" onclick={closeEditor} disabled={saving || removing}>
					Fechar
				</button>
			</div>

			<div class="editor-grid">
				<div class="preview">
					{#if previewUrl || renderedUrl}
						<img
							src={previewUrl ?? renderedUrl ?? ''}
							alt="Prévia do banner"
							style:object-position={`${positionX}% ${positionY}%`}
						/>
					{:else}
						<p>Escolha uma imagem para visualizar o recorte.</p>
					{/if}
				</div>

				<div class="controls">
					<label class="file-control">
						<span>{renderedPath ? 'Trocar imagem' : 'Imagem do banner'}</span>
						<input type="file" accept="image/jpeg,image/png,image/webp" onchange={selectFile} />
						<small>JPG, PNG ou WebP, até 12 MB. A imagem é otimizada antes do envio.</small>
					</label>

					<label>
						<span>Posição horizontal — {positionX}%</span>
						<input type="range" min="0" max="100" step="1" bind:value={positionX} />
					</label>

					<label>
						<span>Posição vertical — {positionY}%</span>
						<input type="range" min="0" max="100" step="1" bind:value={positionY} />
					</label>
				</div>
			</div>

			{#if error}<p class="editor-error" role="alert">{error}</p>{/if}

			<div class="actions">
				{#if renderedPath}
					<button class="remove" type="button" onclick={remove} disabled={saving || removing}>
						{removing ? 'Removendo…' : 'Remover banner'}
					</button>
				{/if}
				<div class="actions-primary">
					<button
						class="secondary"
						type="button"
						onclick={closeEditor}
						disabled={saving || removing}
					>
						Cancelar
					</button>
					<button
						class="primary"
						type="button"
						onclick={save}
						disabled={saving || removing || (!renderedPath && !selectedFile)}
					>
						{saving ? 'Salvando…' : 'Salvar banner'}
					</button>
				</div>
			</div>
		</section>
	{/if}
</div>

<style>
	.banner-shell {
		display: grid;
		gap: 0.85rem;
	}

	.banner {
		position: relative;
		height: clamp(11rem, 24vw, 17rem);
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.banner img,
	.preview img {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: cover;
	}

	.banner-fallback {
		position: absolute;
		inset: 0;
		background: linear-gradient(135deg, rgb(255 255 255 / 5%), transparent 55%), var(--archive);
	}

	.banner-shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgb(0 0 0 / 22%), transparent 45%);
		pointer-events: none;
	}

	.edit-banner,
	.add-banner,
	.close,
	.secondary,
	.remove,
	.primary {
		min-height: 2.6rem;
		padding: 0.6rem 0.85rem;
		border-radius: var(--radius-sm);
		font: inherit;
		font-weight: 720;
		cursor: pointer;
	}

	.edit-banner {
		position: absolute;
		top: 0.8rem;
		right: 0.8rem;
		border: 1px solid rgb(255 255 255 / 45%);
		background: rgb(20 24 21 / 72%);
		color: white;
		backdrop-filter: blur(8px);
	}

	.add-banner-row {
		display: flex;
		justify-content: flex-end;
	}

	.add-banner,
	.close,
	.secondary {
		border: 1px solid var(--line-strong);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.add-banner {
		min-height: 2.35rem;
		padding: 0.5rem 0.75rem;
		color: var(--archive);
		font-size: 0.84rem;
	}

	.editor {
		display: grid;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.editor-heading,
	.actions,
	.actions-primary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.eyebrow {
		margin-bottom: 0.2rem;
		color: var(--archive);
		font-size: 0.7rem;
		font-weight: 780;
		letter-spacing: 0.11em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		font-family: var(--font-heading);
		font-size: 1.65rem;
		font-weight: 540;
	}

	.editor-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(15rem, 0.65fr);
		gap: 1rem;
	}

	.preview {
		height: 12rem;
		overflow: hidden;
		display: grid;
		place-items: center;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--muted);
		text-align: center;
	}

	.preview p {
		max-width: 22rem;
		margin: 0;
		padding: 1rem;
	}

	.controls {
		display: grid;
		align-content: start;
		gap: 1rem;
	}

	.controls label {
		display: grid;
		gap: 0.4rem;
	}

	.controls label > span {
		color: var(--ink);
		font-size: 0.82rem;
		font-weight: 720;
	}

	.file-control input {
		width: 100%;
		padding: 0.55rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.file-control small {
		color: var(--muted);
		font-size: 0.75rem;
		line-height: 1.4;
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--archive);
	}

	.editor-error {
		margin: 0;
		padding: 0.7rem 0.8rem;
		border-left: 0.25rem solid var(--danger);
		background: rgb(155 63 54 / 7%);
		color: var(--danger);
		font-size: 0.84rem;
	}

	.remove {
		border: 1px solid rgb(155 63 54 / 35%);
		background: transparent;
		color: var(--danger);
	}

	.primary {
		border: 1px solid var(--archive);
		background: var(--archive);
		color: white;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	@media (hover: hover) and (pointer: fine) {
		.edit-banner:hover,
		.add-banner:hover,
		.close:hover,
		.secondary:hover,
		.remove:hover,
		.primary:hover {
			filter: brightness(0.97);
		}
	}

	@media (max-width: 720px) {
		.banner {
			height: 10rem;
		}

		.editor-grid {
			grid-template-columns: 1fr;
		}

		.preview {
			height: 9rem;
		}
	}

	@media (max-width: 520px) {
		.editor-heading,
		.actions {
			align-items: stretch;
			flex-direction: column;
		}

		.actions-primary {
			width: 100%;
		}

		.actions-primary > button,
		.remove {
			flex: 1;
		}
	}
</style>
