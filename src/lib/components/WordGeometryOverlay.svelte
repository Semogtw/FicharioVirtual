<script lang="ts">
	import { geometryPercent, matchingWordGeometry, type WordGeometry } from '$lib/ocr/word-geometry';

	interface WordGeometryOverlayProps {
		geometry: readonly WordGeometry[];
		query: string;
	}

	let { geometry, query }: WordGeometryOverlayProps = $props();
	let matches = $derived(matchingWordGeometry(geometry, query));
</script>

{#if matches.length > 0}
	<div class="geometry-layer" aria-hidden="true">
		{#each matches as box, index (`${box.left}:${box.top}:${box.right}:${box.bottom}:${index}`)}
			<mark
				style:left={geometryPercent(box.left)}
				style:top={geometryPercent(box.top)}
				style:width={geometryPercent(box.right - box.left)}
				style:height={geometryPercent(box.bottom - box.top)}
				title={box.text}
			></mark>
		{/each}
	</div>
{/if}

<style>
	.geometry-layer {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
	}

	mark {
		position: absolute;
		box-sizing: border-box;
		min-width: 0.16rem;
		min-height: 0.16rem;
		border: 1px solid rgb(150 91 0 / 72%);
		border-radius: 0.12rem;
		background: rgb(255 214 53 / 48%);
		box-shadow: 0 0 0 1px rgb(255 244 164 / 55%) inset;
	}
</style>
