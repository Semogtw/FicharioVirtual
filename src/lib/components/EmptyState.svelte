<script lang="ts">
	import Button from './Button.svelte';

	interface EmptyStateProps {
		title: string;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
	}

	let { title, description, actionLabel, onAction }: EmptyStateProps = $props();
</script>

<section class="empty-state" aria-labelledby="empty-state-title">
	<div class="folio" aria-hidden="true">
		<span></span>
		<span></span>
		<span></span>
	</div>
	<h2 id="empty-state-title">{title}</h2>
	<p>{description}</p>
	{#if actionLabel}
		<Button label={actionLabel} onclick={onAction} />
	{/if}
</section>

<style>
	.empty-state {
		display: grid;
		justify-items: center;
		max-width: 34rem;
		margin-inline: auto;
		padding: clamp(2rem, 6vw, 4rem);
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-lg);
		background: rgb(var(--surface-rgb) / 76%);
		text-align: center;
	}

	.folio {
		width: 4.5rem;
		height: 5.25rem;
		display: grid;
		align-content: center;
		gap: 0.45rem;
		margin-bottom: 1.25rem;
		padding: 1rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-left: 0.35rem solid var(--archive);
		border-radius: 0.25rem 0.55rem 0.55rem 0.25rem;
		background: var(--surface-strong);
		box-shadow: var(--shadow-soft);
	}

	.folio span {
		height: 0.14rem;
		border-radius: 1rem;
		background: var(--line-strong);
	}

	h2 {
		margin-bottom: 0.55rem;
		font-family: var(--font-heading);
		font-size: clamp(1.55rem, 4vw, 2.15rem);
		font-weight: 520;
	}

	p {
		max-width: 28rem;
		margin-bottom: 1.5rem;
		color: var(--muted);
		line-height: 1.65;
	}
</style>
