<script lang="ts">
	import type { NotebookSummary } from '$lib/domain/notebook';

	interface NotebookCardProps {
		notebook: NotebookSummary;
	}

	let { notebook }: NotebookCardProps = $props();
</script>

<article class={`notebook-card ${notebook.coverStyle}`}>
	<a href={`/notebooks/${notebook.id}/`} aria-label={`Abrir caderno ${notebook.name}`}>
		<div class="binding" aria-hidden="true">
			<span></span><span></span><span></span><span></span>
		</div>
		<div class="cover">
			<p>Caderno</p>
			<h2>{notebook.name}</h2>
			{#if notebook.description}
				<span>{notebook.description}</span>
			{/if}
			<small>
				{notebook.documentCount}
				{notebook.documentCount === 1 ? 'documento' : 'documentos'}
			</small>
		</div>
	</a>
</article>

<style>
	.notebook-card {
		position: relative;
		min-height: 14rem;
		overflow: hidden;
		border: 1px solid #3d5043;
		border-radius: 0.45rem var(--radius-md) var(--radius-md) 0.45rem;
		background: var(--archive);
		color: white;
		box-shadow: var(--shadow-soft);
		transition:
			box-shadow 120ms ease,
			transform 120ms ease;
	}

	.notebook-card:focus-within {
		box-shadow: var(--shadow-raised);
		transform: translateY(-0.15rem);
	}

	a {
		display: grid;
		grid-template-columns: 1.4rem minmax(0, 1fr);
		min-height: 14rem;
	}

	.binding {
		display: grid;
		align-content: space-around;
		justify-items: center;
		padding-block: 0.75rem;
		background: rgb(0 0 0 / 13%);
	}

	.binding span {
		width: 0.45rem;
		height: 1.25rem;
		border: 1px solid rgb(255 255 255 / 48%);
		border-radius: 1rem;
	}

	.cover {
		display: grid;
		align-content: start;
		padding: 1.4rem;
		background:
			linear-gradient(90deg, rgb(255 255 255 / 5%) 1px, transparent 1px) 0 0 / 1.5rem 1.5rem,
			linear-gradient(rgb(255 255 255 / 4%), rgb(0 0 0 / 6%));
	}

	p {
		margin-bottom: 1.1rem;
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.75;
	}

	h2 {
		margin-bottom: 0.65rem;
		font-family: var(--font-heading);
		font-size: clamp(1.6rem, 4vw, 2.25rem);
		font-weight: 520;
		line-height: 1.05;
	}

	.cover > span {
		display: -webkit-box;
		overflow: hidden;
		margin-bottom: 1.5rem;
		line-height: 1.45;
		opacity: 0.8;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}

	small {
		margin-top: auto;
		padding-top: 1.25rem;
		font-weight: 690;
		opacity: 0.78;
	}

	@media (hover: hover) and (pointer: fine) {
		.notebook-card:hover {
			box-shadow: var(--shadow-raised);
			transform: translateY(-0.15rem);
		}
	}
</style>
