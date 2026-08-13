<script lang="ts">
	interface ConfirmDialogProps {
		open: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		busy?: boolean;
		danger?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open,
		title,
		description,
		confirmLabel = 'Confirmar',
		cancelLabel = 'Cancelar',
		busy = false,
		danger = false,
		onConfirm,
		onCancel
	}: ConfirmDialogProps = $props();

	function cancelFromBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget && !busy) onCancel();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open && !busy) {
			event.preventDefault();
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="backdrop" role="presentation" onclick={cancelFromBackdrop}>
		<div
			class="dialog"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-dialog-title"
			aria-describedby="confirm-dialog-description"
		>
			<div class="copy">
				<p class="eyebrow">Confirmação</p>
				<h2 id="confirm-dialog-title">{title}</h2>
				<p id="confirm-dialog-description">{description}</p>
			</div>
			<div class="actions">
				<button type="button" class="secondary" disabled={busy} onclick={onCancel}>
					{cancelLabel}
				</button>
				<button type="button" class:danger disabled={busy} onclick={onConfirm}>
					{busy ? 'Aguarde…' : confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		z-index: 100;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgb(20 20 18 / 58%);
		backdrop-filter: blur(5px);
	}

	.dialog {
		width: min(30rem, 100%);
		display: grid;
		gap: 1.25rem;
		padding: 1.25rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--surface-strong);
		box-shadow: var(--shadow-soft);
	}

	.copy {
		display: grid;
		gap: 0.55rem;
	}

	.eyebrow,
	h2,
	p {
		margin: 0;
	}

	.eyebrow {
		color: var(--archive);
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h2 {
		font-family: var(--font-heading);
		font-size: 1.7rem;
		font-weight: 560;
		letter-spacing: -0.025em;
	}

	.copy p:last-child {
		color: var(--muted);
		line-height: 1.55;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}

	button {
		min-height: 2.65rem;
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font: inherit;
		font-weight: 740;
		cursor: pointer;
	}

	button.secondary {
		background: var(--surface);
		color: var(--ink);
	}

	button.danger {
		border-color: rgb(155 63 54 / 35%);
		background: var(--danger);
		color: white;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	@media (max-width: 520px) {
		.dialog {
			align-self: end;
		}

		.actions {
			flex-direction: column-reverse;
		}

		button {
			width: 100%;
		}
	}
</style>
