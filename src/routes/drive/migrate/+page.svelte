<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		listLegacyDriveDocuments,
		migrateLegacyDriveDocument,
		type LegacyDriveDocument
	} from '$lib/drive/legacy-migration';

	let documents = $state<readonly LegacyDriveDocument[]>([]);
	let loading = $state(true);
	let migratingId = $state<string | null>(null);
	let migratingAll = $state(false);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);

	function formatDate(value: string) {
		return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
			new Date(value)
		);
	}

	async function load() {
		if (migratingId !== null || migratingAll) return;
		loading = true;
		error = null;
		try {
			documents = await listLegacyDriveDocuments();
		} catch (caught) {
			error =
				caught instanceof Error
					? caught.message
					: 'Não foi possível carregar os originais legados para migração.';
		} finally {
			loading = false;
		}
	}

	async function migrateOne(document: LegacyDriveDocument, quiet = false): Promise<boolean> {
		if (migratingId !== null) return false;
		migratingId = document.id;
		if (!quiet) {
			error = null;
			message = null;
		}
		try {
			await migrateLegacyDriveDocument(document);
			documents = documents.filter((item) => item.id !== document.id);
			if (!quiet) {
				message = `“${document.title}” foi copiado para o Drive. O fallback no Supabase permanece preservado.`;
			}
			return true;
		} catch (caught) {
			if (!quiet) {
				error =
					caught instanceof Error
						? caught.message
						: 'Não foi possível migrar o original para o Google Drive.';
			}
			return false;
		} finally {
			migratingId = null;
		}
	}

	async function migrateAll() {
		if (migratingAll || migratingId !== null || documents.length === 0) return;
		migratingAll = true;
		error = null;
		message = null;
		let successes = 0;
		let failures = 0;
		for (const document of [...documents]) {
			if (await migrateOne(document, true)) successes += 1;
			else failures += 1;
		}
		migratingAll = false;
		await load();
		message = `${successes} originais migrados com fallback preservado.${failures > 0 ? ` ${failures} permaneceram pendentes para nova tentativa.` : ''}`;
	}

	onMount(() => {
		void load();
	});
</script>

<svelte:head>
	<title>Migrar originais — Fichário Virtual</title>
</svelte:head>

<div class="page" aria-labelledby="page-title">
	<header>
		<div>
			<p class="eyebrow">Transição segura</p>
			<h1 id="page-title">Migrar originais legados</h1>
			<p>
				Copie para o Google Drive os originais criados antes da arquitetura Drive-first. A cópia
				privada do Supabase não é removida nesta etapa.
			</p>
		</div>
		<div class="header-actions">
			<Button
				label={migratingAll ? 'Migrando fila…' : 'Migrar todos'}
				disabled={loading || migratingAll || migratingId !== null || documents.length === 0}
				onclick={() => void migrateAll()}
			/>
			<Button
				label={loading ? 'Atualizando…' : 'Atualizar'}
				variant="secondary"
				disabled={loading || migratingAll || migratingId !== null}
				onclick={() => void load()}
			/>
		</div>
	</header>

	<section class="safety" aria-labelledby="safety-title">
		<h2 id="safety-title">Fallback preservado</h2>
		<p>
			Cada arquivo é baixado do bucket privado, enviado por sessão retomável ao Drive e vinculado
			com compare-and-swap. Se o banco recusar, a nova cópia do Drive é apagada; o original legado
			permanece intacto.
		</p>
	</section>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}

	<section class="panel" aria-labelledby="pending-title">
		<div class="panel-heading">
			<div>
				<p class="eyebrow">Originais permanentes no Supabase</p>
				<h2 id="pending-title">Pendentes</h2>
			</div>
			<span>{documents.length}</span>
		</div>

		{#if loading}
			<p class="empty" role="status">Procurando originais legados…</p>
		{:else if documents.length === 0}
			<p class="empty">Nenhum original legado aguarda migração.</p>
		{:else}
			<ul>
				{#each documents as document (document.id)}
					<li>
						<div>
							<strong>{document.title}</strong>
							<small>
								{document.kind === 'pdf' ? 'PDF' : 'Imagem'} · {document.originalFilename} · criado em
								{formatDate(document.createdAt)}
							</small>
							<a href={`/documents/${document.id}/`}>Abrir documento</a>
						</div>
						<Button
							label={migratingId === document.id ? 'Migrando…' : 'Migrar original'}
							disabled={migratingAll || migratingId !== null}
							onclick={() => void migrateOne(document)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: 1.25rem;
	}

	header,
	.header-actions,
	.panel-heading,
	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	header {
		align-items: end;
	}

	.header-actions {
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--archive);
		font-size: 0.74rem;
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
		margin: 0 0 0.5rem;
		font-size: clamp(2.4rem, 6vw, 4.5rem);
		letter-spacing: -0.04em;
	}

	header p:last-child,
	.safety p {
		max-width: 56rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	.safety,
	.panel {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.safety {
		border-left: 0.3rem solid var(--archive);
	}

	.safety h2,
	.panel h2 {
		margin: 0 0 0.4rem;
	}

	.panel-heading > span {
		min-width: 2rem;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		background: var(--archive-soft);
		color: var(--archive);
		font-weight: 780;
		text-align: center;
	}

	ul {
		display: grid;
		gap: 0.7rem;
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
	}

	li > div {
		display: grid;
		gap: 0.3rem;
	}

	small,
	.empty {
		color: var(--muted);
		line-height: 1.45;
	}

	li a {
		color: var(--archive);
		font-size: 0.86rem;
		font-weight: 720;
	}

	.empty {
		margin: 1rem 0 0;
		padding: 1rem;
		text-align: center;
	}

	.error,
	.message {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border-left: 0.3rem solid var(--danger);
		background: rgb(var(--danger-rgb) / 7%);
		color: var(--danger);
	}

	.message {
		border-color: var(--archive);
		background: var(--archive-soft);
		color: var(--archive);
	}

	@media (max-width: 720px) {
		header,
		li {
			align-items: stretch;
			flex-direction: column;
		}

		.header-actions {
			justify-content: stretch;
		}
	}
</style>
