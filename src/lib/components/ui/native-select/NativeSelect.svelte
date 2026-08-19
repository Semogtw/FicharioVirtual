<script lang="ts">
	import type { Snippet } from 'svelte';

	interface NativeSelectProps {
		value?: string;
		disabled?: boolean;
		ariaLabel?: string;
		name?: string;
		id?: string;
		onchange?: (event: Event) => void;
		onfocus?: (event: FocusEvent) => void;
		onpointerdown?: (event: PointerEvent) => void;
		children: Snippet;
	}

	let {
		value = $bindable(''),
		disabled = false,
		ariaLabel,
		name,
		id,
		onchange,
		onfocus,
		onpointerdown,
		children
	}: NativeSelectProps = $props();
</script>

<div class="native-select">
	<select
		bind:value
		{disabled}
		aria-label={ariaLabel}
		{name}
		{id}
		{onchange}
		{onfocus}
		{onpointerdown}
	>
		{@render children()}
	</select>
	<svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
		<path
			d="m6 8 4 4 4-4"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
</div>

<style>
	.native-select {
		position: relative;
		width: 100%;
	}

	select {
		width: 100%;
		min-height: 2.875rem;
		appearance: none;
		padding: 0.625rem 2.5rem 0.625rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
		cursor: pointer;
		transform: translateY(0);
		transition:
			border-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-base) var(--ease-soft),
			background-color var(--motion-fast) var(--ease-standard),
			transform var(--motion-base) var(--ease-emphasized);
	}

	select:hover:not(:disabled) {
		border-color: var(--archive);
	}

	select:focus-visible {
		border-color: var(--archive);
		box-shadow: 0 0.35rem 1rem rgb(var(--ink-rgb) / 7%);
		transform: translateY(-1px);
	}

	select:disabled {
		cursor: not-allowed;
		opacity: 0.58;
	}

	svg {
		position: absolute;
		top: 50%;
		right: 0.75rem;
		width: 1rem;
		height: 1rem;
		transform: translateY(-50%) rotate(0deg);
		color: var(--muted-strong);
		pointer-events: none;
		transition:
			color var(--motion-fast) var(--ease-standard),
			transform var(--motion-base) var(--ease-emphasized);
	}

	.native-select:focus-within svg {
		color: var(--archive);
		transform: translateY(-50%) rotate(180deg);
	}

	@media (hover: none), (pointer: coarse) {
		select {
			min-height: 3rem;
		}
	}
</style>
