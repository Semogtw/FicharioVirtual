<script lang="ts">
	import { tick } from 'svelte';

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

	let dialog = $state<HTMLDivElement | null>(null);
	let cancelButton = $state<HTMLButtonElement | null>(null);
	let previouslyFocused: HTMLElement | null = null;
	let dialogWasOpen = false;

	function focusableElements() {
		if (!dialog) return [];
		return Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => element.getAttribute('aria-hidden') !== 'true');
	}

	function trapFocus(event: KeyboardEvent) {
		if (!open || event.key !== 'Tab' || !dialog) return;
		const elements = focusableElements();
		if (elements.length === 0) {
			event.preventDefault();
			dialog.focus();
			return;
		}
		const first = elements[0];
		const last = elements.at(-1);
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function cancelFromBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget && !busy) onCancel();
	}

	function handleKeydown(event: KeyboardEvent) {
		trapFocus(event);
		if (event.key === 'Escape' && open && !busy) {
			event.preventDefault();
			onCancel();
		}
	}

	$effect(() => {
		if (open && !dialogWasOpen) {
			dialogWasOpen = true;
			previouslyFocused =
				document.activeElement instanceof HTMLElement ? document.activeElement : null;
			void tick().then(() => cancelButton?.focus({ preventScroll: true }));
		} else if (!open && dialogWasOpen) {
			dialogWasOpen = false;
			const target = previouslyFocused;
			previouslyFocused = null;
			if (target?.isConnected) target.focus({ preventScroll: true });
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="backdrop" role="presentation" onclick={cancelFromBackdrop}>
		<div
			class="dialog"
			bind:this={dialog}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			aria-labelledby="confirm-dialog-title"
			aria-describedby="confirm-dialog-description"
		>
			<div class="copy" aria-live="assertive">
				<p class="eyebrow">Confirmação</p>
				<h2 id="confirm-dialog-title">{title}</h2>
				<p id="confirm-dialog-description">{description}</p>
			</div>
			<div class="actions">
				<button
					bind:this={cancelButton}
					type="button"
					class="secondary"
					disabled={busy}
					onclick={onCancel}
				>
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
		overscroll-behavior: contain;
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
