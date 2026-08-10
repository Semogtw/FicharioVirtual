<script lang="ts">
	import { highlightSnippet, searchMatchSnippet } from '$lib/search/highlight';

	interface SearchMatchProps {
		text: string;
		query: string;
		label?: string;
		maximumLength?: number;
		compact?: boolean;
	}

	let {
		text,
		query,
		label = 'Correspondência encontrada',
		maximumLength = 280,
		compact = false
	}: SearchMatchProps = $props();

	let excerpt = $derived(searchMatchSnippet(text, query, maximumLength));
	let parts = $derived(highlightSnippet(excerpt, query));
	let hasMatch = $derived(parts.some((part) => part.highlighted));
</script>

{#if query.trim() && excerpt}
	<aside class:compact class:approximate={!hasMatch} class="search-match" aria-label={label}>
		<strong>{label}</strong>
		<p>
			{#each parts as part}
				{#if part.highlighted}<mark>{part.text}</mark>{:else}{part.text}{/if}
			{/each}
		</p>
		{#if !hasMatch}
			<small
				>A página foi recuperada por similaridade, mas não há um único token seguro para marcar.</small
			>
		{/if}
	</aside>
{/if}

<style>
	.search-match {
		display: grid;
		gap: 0.35rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid rgb(184 132 32 / 42%);
		border-radius: var(--radius-sm);
		background: rgb(255 244 190 / 94%);
		color: #4b3b13;
		box-shadow: 0 0.4rem 1.5rem rgb(40 32 14 / 12%);
	}

	.search-match.compact {
		gap: 0.2rem;
		padding: 0.55rem 0.65rem;
		font-size: 0.86rem;
	}

	.search-match.approximate {
		border-style: dashed;
	}

	strong {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	p,
	small {
		margin: 0;
	}

	p {
		line-height: 1.55;
	}

	mark {
		padding-inline: 0.1em;
		border-radius: 0.18em;
		background: #ffd75a;
		color: #211b0d;
		font-weight: 760;
		box-shadow: 0 0 0 0.08rem rgb(121 82 0 / 18%);
	}

	small {
		color: #6d5a29;
		font-size: 0.72rem;
		line-height: 1.4;
	}
</style>
