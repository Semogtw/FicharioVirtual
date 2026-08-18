<script lang="ts">
	import type { NotebookSummary } from '$lib/domain/notebook';

	interface NotebookCardProps {
		notebook: NotebookSummary;
		parentName?: string | null;
	}

	let { notebook, parentName = null }: NotebookCardProps = $props();
</script>

<article class={`notebook-card ${notebook.coverStyle}`}>
	<a href={`/notebooks/${notebook.id}/`} aria-label={`Abrir caderno ${notebook.name}`}>
		<div class="binding" aria-hidden="true">
			<span></span><span></span><span></span><span></span>
		</div>
		<div class="cover">
			<p>{parentName ? `Sub-caderno · ${parentName}` : 'Caderno'}</p>
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
		transform: translateY(0) rotate(0deg) scale(1);
		animation: notebook-card-enter var(--motion-slow) var(--ease-soft) both;
		transition:
			box-shadow var(--motion-slow) var(--ease-soft),
			transform var(--motion-base) var(--ease-emphasized);
	}

	@keyframes notebook-card-enter {
		from {
			opacity: 0;
			transform: translateY(0.6rem) scale(0.99);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.notebook-card:focus-within {
		box-shadow: var(--shadow-raised);
		transform: translateY(-0.2rem) rotate(-0.12deg) scale(1.002);
	}

	a {
		display: grid;
		grid-template-columns: 1.4rem minmax(0, 1fr);
		min-height: 14rem;
		transform: scale(1);
		transition: transform var(--motion-base) var(--ease-emphasized);
	}

	a:active {
		transform: scale(0.985);
		transition-duration: var(--motion-instant);
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
		transform: translateX(0);
		transition: transform var(--motion-base) var(--ease-emphasized);
	}

	.cover {
		display: grid;
		align-content: start;
		padding: 1.4rem;
		background:
			linear-gradient(90deg, rgb(255 255 255 / 5%) 1px, transparent 1px) 0 0 / 1.5rem 1.5rem,
			linear-gradient(rgb(255 255 255 / 4%), rgb(0 0 0 / 6%));
	}

	.cover::after {
		position: absolute;
		inset: 0;
		content: '';
		pointer-events: none;
		background: linear-gradient(110deg, transparent 20%, rgb(255 255 255 / 5%) 46%, transparent 72%);
		opacity: 0;
		transform: translateX(-10%);
		transition:
			opacity var(--motion-base) var(--ease-soft),
			transform var(--motion-slow) var(--ease-soft);
	}

	p {
		overflow: hidden;
		margin-bottom: 1.1rem;
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.12em;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
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
			transform: translateY(-0.24rem) rotate(-0.18deg) scale(1.003);
		}

		.notebook-card:hover .cover::after {
			opacity: 1;
			transform: translateX(8%);
		}

		.notebook-card:hover .binding span:nth-child(odd) {
			transform: translateX(-1px);
		}

		.notebook-card:hover .binding span:nth-child(even) {
			transform: translateX(1px);
		}
	}
</style>
