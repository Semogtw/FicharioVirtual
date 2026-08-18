<script lang="ts">
	type LoadingVariant = 'documents' | 'notebooks' | 'search';

	interface LoadingCollectionProps {
		variant?: LoadingVariant;
		count?: number;
		label?: string;
	}

	let {
		variant = 'documents',
		count = 6,
		label = 'Carregando conteúdo…'
	}: LoadingCollectionProps = $props();

	let items = $derived(Array.from({ length: Math.max(1, Math.min(count, 8)) }));
</script>

<section class={`loading-collection ${variant}`} role="status" aria-busy="true">
	<span class="visually-hidden">{label}</span>
	<div class="skeleton-grid" aria-hidden="true">
		{#each items as _, index}
			<article class="skeleton-card" style={`--skeleton-index: ${index}`}>
				{#if variant === 'notebooks'}
					<div class="notebook-binding"></div>
				{/if}
				<div class="skeleton-body">
					<div class="skeleton-preview"></div>
					<div class="skeleton-line strong"></div>
					<div class="skeleton-line"></div>
				</div>
			</article>
		{/each}
	</div>
</section>

<style>
	.loading-collection {
		min-width: 0;
	}

	.skeleton-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
	}

	.notebooks .skeleton-grid {
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
	}

	.search .skeleton-grid {
		grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
		gap: 0.9rem;
	}

	.skeleton-card {
		position: relative;
		min-width: 0;
		display: grid;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
		opacity: 0;
		transform: translateY(0.45rem) scale(0.995);
		animation: skeleton-enter var(--motion-slow) var(--ease-soft) forwards;
		animation-delay: calc(var(--skeleton-index) * 35ms);
	}

	.notebooks .skeleton-card {
		grid-template-columns: 1.25rem minmax(0, 1fr);
		min-height: 14rem;
		border-color: rgb(var(--archive-rgb) / 28%);
		background: rgb(var(--archive-rgb) / 13%);
	}

	.notebook-binding {
		background: rgb(var(--archive-rgb) / 18%);
	}

	.skeleton-body {
		position: relative;
		display: grid;
		gap: 0.7rem;
		padding: 0.9rem;
		overflow: hidden;
	}

	.skeleton-body::after {
		position: absolute;
		inset: 0;
		content: '';
		pointer-events: none;
		background: linear-gradient(
			105deg,
			transparent 32%,
			rgb(var(--surface-rgb) / 58%) 48%,
			transparent 64%
		);
		transform: translateX(-120%);
		animation: skeleton-sheen 1.45s var(--ease-in-out) infinite;
		animation-delay: calc(var(--skeleton-index) * 55ms);
	}

	.skeleton-preview,
	.skeleton-line {
		border-radius: calc(var(--radius-sm) - 0.1rem);
		background: rgb(var(--line-rgb) / 68%);
	}

	.skeleton-preview {
		min-height: 10.5rem;
	}

	.search .skeleton-preview {
		min-height: 16rem;
	}

	.notebooks .skeleton-preview {
		min-height: 8rem;
		background: rgb(var(--archive-rgb) / 16%);
	}

	.skeleton-line {
		height: 0.62rem;
		width: 58%;
	}

	.skeleton-line.strong {
		height: 0.82rem;
		width: 78%;
	}

	@keyframes skeleton-enter {
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes skeleton-sheen {
		0%,
		20% {
			transform: translateX(-120%);
		}
		80%,
		100% {
			transform: translateX(120%);
		}
	}
</style>
