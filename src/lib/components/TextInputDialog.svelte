<script lang="ts">
	interface TextInputDialogProps {
		open: boolean;
		title: string;
		description?: string;
		label: string;
		value: string;
		placeholder?: string;
		maximumLength?: number;
		confirmLabel?: string;
		cancelLabel?: string;
		busy?: boolean;
		onValueChange: (value: string) => void;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open,
		title,
		description = '',
		label,
		value,
		placeholder = '',
		maximumLength = 240,
		confirmLabel = 'Salvar',
		cancelLabel = 'Cancelar',
		busy = false,
		onValueChange,
		onConfirm,
		onCancel
	}: TextInputDialogProps = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (!open || busy) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			onCancel();
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || value.trim().length === 0) return;
		onConfirm();
	}

	function cancelFromBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget && !busy) onCancel();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="backdrop" role="presentation" onclick={cancelFromBackdrop}>
		<form class="dialog" aria-labelledby="text-dialog-title" onsubmit={submit}>
			<div class="copy">
				<p class="eyebrow">Editar</p>
				<h2 id="text-dialog-title">{title}</h2>
				{#if description}<p>{description}</p>{/if}
			</div>
			<label>
				<span>{label}</span>
				<input
					maxlength={maximumLength}
					{placeholder}
					{value}
					oninput={(event) => onValueChange(event.currentTarget.value)}
				/>
			</label>
			<div class="actions">
				<button type="button" class="secondary" disabled={busy} onclick={onCancel}>
					{cancelLabel}
				</button>
				<button type="submit" disabled={busy || value.trim().length === 0}>
					{busy ? 'Aguarde…' : confirmLabel}
				</button>
			</div>
		</form>
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
		gap: 1rem;
		padding: 1.25rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--surface-strong);
		box-shadow: var(--shadow-soft);
	}

	.copy {
		display: grid;
		gap: 0.5rem;
	}

	.copy p,
	h2 {
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

	.copy p:last-child:not(.eyebrow) {
		color: var(--muted);
		line-height: 1.5;
	}

	label {
		display: grid;
		gap: 0.35rem;
	}

	label span {
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 720;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		min-height: 2.8rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
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
