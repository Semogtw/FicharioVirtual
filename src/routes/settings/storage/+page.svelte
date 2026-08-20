<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { trimNativeCache, type NativeCacheTrimResult } from '$lib/native/cache-management';
	import { getNativeStatus, type NativeStatus } from '$lib/native/local-document-store';
	import { isNativeRuntime } from '$lib/platform/native-bridge';

	const native = isNativeRuntime();
	let status = $state<NativeStatus | null>(null);
	let loading = $state(true);
	let trimming = $state(false);
	let targetGb = $state(5);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);
	let lastTrim = $state<NativeCacheTrimResult | null>(null);

	function formatBytes(bytes: number) {
		if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		return `${(bytes / 1024 ** index).toLocaleString('pt-BR', { maximumFractionDigits: index >= 3 ? 1 : 0 })} ${units[index]}`;
	}

	async function refresh() {
		loading = true;
		error = null;
		try {
			status = native ? await getNativeStatus() : null;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível ler o armazenamento local.';
		} finally {
			loading = false;
		}
	}

	async function trim() {
		if (!native || trimming) return;
		if (!Number.isFinite(targetGb) || targetGb < 0 || targetGb > 1024) {
			error = 'Escolha um limite entre 0 e 1024 GB.';
			return;
		}
		trimming = true;
		error = null;
		message = null;
		try {
			lastTrim = await trimNativeCache(Math.round(targetGb * 1024 ** 3));
			await refresh();
			if (lastTrim) {
				message = lastTrim.releasedBytes
					? `${formatBytes(lastTrim.releasedBytes)} liberados. Arquivos sem backup foram preservados.`
					: 'Nada precisou ser removido. Arquivos sem backup continuam protegidos.';
			}
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Não foi possível reduzir o armazenamento local.';
		} finally {
			trimming = false;
		}
	}

	onMount(() => void refresh());
</script>

<svelte:head><title>Armazenamento — Fichário Virtual</title></svelte:head>

<div class="page" aria-labelledby="storage-title">
	<header>
		<p class="eyebrow">Aplicativo</p>
		<h1 id="storage-title">Armazenamento local</h1>
		<p>Originais salvos neste dispositivo abrem direto do armazenamento local, sem depender do Drive.</p>
	</header>

	{#if !native}
		<section class="card">
			<h2>Disponível no aplicativo</h2>
			<p>Esta área é usada nas versões Android, Linux e Windows.</p>
		</section>
	{:else if loading && !status}
		<p role="status">Lendo armazenamento…</p>
	{:else}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if message}<p class="message" role="status">{message}</p>{/if}
		{#if status}
			<section class="stats" aria-label="Resumo do armazenamento local">
				<article><span>Espaço usado</span><strong>{formatBytes(status.diskUsageBytes)}</strong></article>
				<article><span>Originais locais</span><strong>{status.localDocumentCount}</strong></article>
				<article><span>Sync pendente</span><strong>{status.pendingSyncCount}</strong></article>
				<article><span>Plataforma</span><strong>{status.platform}</strong></article>
			</section>
		{/if}
		<section class="card controls">
			<div>
				<h2>Limite de cache</h2>
				<p>Ao reduzir o uso, somente originais já sincronizados podem ser removidos. Arquivos ainda sem backup são sempre protegidos.</p>
			</div>
			<label for="cache-limit">Manter até</label>
			<div class="limit"><input id="cache-limit" type="number" min="0" max="1024" step="1" bind:value={targetGb} disabled={trimming} /><span>GB</span></div>
			<Button label={trimming ? 'Liberando…' : 'Aplicar agora'} variant="secondary" disabled={trimming} onclick={() => void trim()} />
		</section>
		{#if lastTrim && lastTrim.protectedDocuments > 0}
			<p class="message">{lastTrim.protectedDocuments} arquivo(s) sem backup permaneceram no dispositivo.</p>
		{/if}
	{/if}
</div>

<style>
	.page { display: grid; gap: 1rem; }
	.eyebrow { margin: 0 0 .35rem; color: var(--archive); font-size: .75rem; font-weight: 780; letter-spacing: .12em; text-transform: uppercase; }
	h1, h2 { font-family: var(--font-heading); font-weight: 540; }
	h1 { margin: 0 0 .55rem; font-size: clamp(2.4rem, 6vw, 4.5rem); letter-spacing: -.04em; }
	header p:last-child, .card p { max-width: 52rem; margin: 0; color: var(--muted); line-height: 1.55; }
	.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; }
	.stats article, .card, .message, .error { padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
	.stats article { display: grid; gap: .35rem; }
	.stats span, label { color: var(--muted); font-size: .8rem; font-weight: 700; }
	.stats strong { font-size: 1.35rem; font-variant-numeric: tabular-nums; }
	.controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .8rem 1rem; align-items: end; }
	.controls > div:first-child { grid-row: span 2; align-self: center; }
	.limit { display: flex; gap: .45rem; align-items: center; }
	input { width: 8rem; min-height: 2.65rem; padding: .55rem .7rem; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-strong); color: var(--ink); font: inherit; }
	.error { color: var(--danger); }
	.message { margin: 0; color: var(--muted); }
	@media (max-width: 800px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .controls { grid-template-columns: 1fr; } .controls > div:first-child { grid-row: auto; } }
	@media (max-width: 430px) { .stats { grid-template-columns: 1fr; } }
</style>
