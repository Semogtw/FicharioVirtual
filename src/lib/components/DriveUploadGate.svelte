<script lang="ts">
	import Button from './Button.svelte';
	import {
		cancelDriveUpload,
		connectDriveForUpload,
		driveUploadGate
	} from '$lib/stores/drive-upload-gate.svelte';

	let dialog = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		if (!dialog) return;
		if (driveUploadGate.visible && !dialog.open) dialog.showModal();
		if (!driveUploadGate.visible && dialog.open) dialog.close();
	});

	function cancel(event?: Event) {
		event?.preventDefault();
		cancelDriveUpload();
	}
</script>

<dialog
	bind:this={dialog}
	class="drive-upload-dialog"
	oncancel={cancel}
	aria-labelledby="drive-upload-title"
>
	<div class="dialog-content">
		<div class="drive-mark" aria-hidden="true">G</div>
		<div class="copy">
			<p class="eyebrow">Google Drive</p>
			<h2 id="drive-upload-title">Entre no Google Drive para continuar</h2>
			<p>
				Seus arquivos são guardados no Google Drive. Conecte sua conta e o envio continua
				automaticamente, sem precisar escolher o arquivo de novo.
			</p>
		</div>

		{#if driveUploadGate.error}
			<p class="error" role="alert">{driveUploadGate.error}</p>
		{/if}

		<div class="actions">
			<Button
				label={driveUploadGate.connecting
					? 'Aguardando login…'
					: driveUploadGate.checking
						? 'Verificando…'
						: 'Conectar Google Drive'}
				disabled={!driveUploadGate.configured ||
					driveUploadGate.connecting ||
					driveUploadGate.checking}
				onclick={() => void connectDriveForUpload()}
			/>
			<button class="secondary" type="button" onclick={cancel}>Cancelar envio</button>
		</div>
	</div>
</dialog>

<style>
	.drive-upload-dialog {
		width: min(calc(100% - 2rem), 30rem);
		margin: auto;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--ink);
		opacity: 0;
		transform: translateY(0.75rem) scale(0.975);
		transition:
			display var(--motion-base) allow-discrete,
			overlay var(--motion-base) allow-discrete,
			opacity var(--motion-base) var(--ease-soft),
			transform var(--motion-base) var(--ease-emphasized),
			box-shadow var(--motion-slow) var(--ease-soft);
	}

	.drive-upload-dialog[open] {
		opacity: 1;
		transform: translateY(0) scale(1);
		box-shadow: var(--shadow-raised);
	}

	@starting-style {
		.drive-upload-dialog[open] {
			opacity: 0;
			transform: translateY(0.75rem) scale(0.975);
			box-shadow: none;
		}
	}

	.drive-upload-dialog::backdrop {
		background: rgb(var(--ink-rgb) / 0%);
		backdrop-filter: blur(0);
		transition:
			display var(--motion-base) allow-discrete,
			overlay var(--motion-base) allow-discrete,
			background-color var(--motion-base) var(--ease-soft),
			backdrop-filter var(--motion-base) var(--ease-soft);
	}

	.drive-upload-dialog[open]::backdrop {
		background: rgb(var(--ink-rgb) / 48%);
		backdrop-filter: blur(0.2rem);
	}

	@starting-style {
		.drive-upload-dialog[open]::backdrop {
			background: rgb(var(--ink-rgb) / 0%);
			backdrop-filter: blur(0);
		}
	}

	.dialog-content {
		display: grid;
		gap: 1rem;
		padding: clamp(1.25rem, 5vw, 2rem);
	}

	.drive-mark {
		width: 3rem;
		height: 3rem;
		display: grid;
		place-items: center;
		border-radius: 0.8rem;
		background: var(--archive-soft);
		color: var(--archive);
		font-family: var(--font-heading);
		font-size: 1.15rem;
		font-weight: 760;
		transform: translateY(0) rotate(0deg) scale(1);
		transition: transform var(--motion-slow) var(--ease-emphasized);
	}

	.drive-upload-dialog[open] .drive-mark {
		animation: drive-mark-enter var(--motion-slow) var(--ease-emphasized) both;
	}

	@keyframes drive-mark-enter {
		from {
			opacity: 0;
			transform: translateY(0.35rem) rotate(-4deg) scale(0.9);
		}
		to {
			opacity: 1;
			transform: translateY(0) rotate(0deg) scale(1);
		}
	}

	.copy {
		display: grid;
		gap: 0.55rem;
	}

	.eyebrow,
	h2,
	.copy > p,
	.error {
		margin: 0;
	}

	.eyebrow {
		color: var(--archive);
		font-size: 0.75rem;
		font-weight: 780;
		letter-spacing: 0.11em;
		text-transform: uppercase;
	}

	h2 {
		font-family: var(--font-heading);
		font-size: clamp(1.6rem, 5vw, 2.2rem);
		font-weight: 540;
		letter-spacing: -0.025em;
	}

	.copy > p:last-child {
		color: var(--muted);
		line-height: 1.55;
	}

	.error {
		padding: 0.8rem 0.9rem;
		border-left: 0.25rem solid var(--danger);
		background: var(--danger-soft);
		color: var(--danger);
		line-height: 1.45;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.secondary {
		min-height: 2.75rem;
		padding: 0.65rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: inherit;
		font: inherit;
		font-weight: 720;
		cursor: pointer;
		transform: translateY(0) scale(1);
		transition:
			background-color var(--motion-fast) var(--ease-standard),
			border-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-base) var(--ease-soft),
			transform var(--motion-base) var(--ease-emphasized);
	}

	.secondary:active {
		box-shadow: none;
		transform: translateY(1px) scale(0.965);
		transition-duration: var(--motion-instant);
	}

	@media (hover: hover) and (pointer: fine) {
		.secondary:hover {
			border-color: var(--archive);
			background: var(--archive-soft);
			box-shadow: 0 0.45rem 1rem rgb(var(--ink-rgb) / 8%);
			transform: translateY(-1px) scale(1.005);
		}
	}

	@media (max-width: 520px) {
		.actions {
			display: grid;
		}

		.secondary {
			width: 100%;
		}
	}
</style>
