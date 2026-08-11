<script lang="ts">
	type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
	type ButtonType = 'button' | 'submit' | 'reset';

	interface ButtonProps {
		label: string;
		type?: ButtonType;
		variant?: ButtonVariant;
		disabled?: boolean;
		ariaLabel?: string;
		onclick?: (event: MouseEvent) => void;
	}

	let {
		label,
		type = 'button',
		variant = 'primary',
		disabled = false,
		ariaLabel,
		onclick
	}: ButtonProps = $props();
</script>

<button {type} class={`button ${variant}`} {disabled} aria-label={ariaLabel} {onclick}>
	{label}
</button>

<style>
	.button {
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.7rem 1rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-weight: 720;
		line-height: 1;
		cursor: pointer;
		transform: translateY(0) scale(1);
		transition:
			background-color var(--motion-fast) var(--ease-standard),
			border-color var(--motion-fast) var(--ease-standard),
			color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-base) var(--ease-standard),
			transform var(--motion-fast) var(--ease-emphasized);
	}

	.button:not(:disabled):active {
		box-shadow: none;
		transform: translateY(1px) scale(0.98);
		transition-duration: var(--motion-instant);
	}

	.primary {
		background: var(--archive);
		color: white;
	}

	.primary:hover:not(:disabled) {
		background: var(--archive-strong);
	}

	.secondary {
		border-color: var(--line-strong);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.secondary:hover:not(:disabled),
	.quiet:hover:not(:disabled) {
		background: var(--archive-soft);
	}

	.quiet {
		background: transparent;
		color: var(--archive);
	}

	.danger {
		background: var(--danger);
		color: white;
	}

	.button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	@media (hover: hover) and (pointer: fine) {
		.button:not(:disabled):hover {
			box-shadow: 0 0.45rem 1.1rem rgb(var(--ink-rgb) / 10%);
			transform: translateY(-1px);
		}

		.button:not(:disabled):active {
			box-shadow: none;
			transform: translateY(1px) scale(0.98);
		}
	}
</style>
