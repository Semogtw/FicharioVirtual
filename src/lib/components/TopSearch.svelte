<script lang="ts">
	interface TopSearchProps {
		initialValue?: string;
		placeholder?: string;
		onSearch?: (query: string) => void;
	}

	let {
		initialValue = '',
		placeholder = 'Pesquisar páginas, documentos e cadernos',
		onSearch
	}: TopSearchProps = $props();

	let query = $derived(initialValue);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const normalized = query.trim();
		if (normalized.length > 0) onSearch?.(normalized);
	}
</script>

<form role="search" aria-label="Pesquisar no fichário" onsubmit={submit}>
	<label class="visually-hidden" for="global-search">Pesquisar no fichário</label>
	<svg class="search-icon" aria-hidden="true" viewBox="0 0 24 24">
		<path d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
	</svg>
	<input id="global-search" bind:value={query} {placeholder} autocomplete="off" />
	<button type="submit" aria-label="Executar pesquisa">
		<span class="submit-label">Buscar</span>
		<svg class="submit-icon" aria-hidden="true" viewBox="0 0 24 24">
			<path d="M5 12h13m-5-5 5 5-5 5" />
		</svg>
	</button>
</form>

<style>
	form {
		width: 100%;
		min-width: 0;
		flex: 1 1 36rem;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		min-height: 3rem;
		padding: 0.3rem 0.35rem 0.3rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface-strong);
		box-shadow: 0 0.25rem 1rem rgb(var(--ink-rgb) / 5%);
		transition:
			border-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-base) var(--ease-standard),
			transform var(--motion-base) var(--ease-emphasized);
	}

	form:focus-within {
		border-color: var(--line-strong);
		box-shadow: 0 0.45rem 1.35rem rgb(var(--ink-rgb) / 8%);
		transform: translateY(-1px);
	}

	svg {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.search-icon {
		width: 1.15rem;
		height: 1.15rem;
		stroke: var(--muted);
		transition:
			stroke var(--motion-fast) var(--ease-standard),
			transform var(--motion-base) var(--ease-emphasized);
	}

	form:focus-within .search-icon {
		stroke: var(--archive);
		transform: scale(1.06);
	}

	input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ink);
	}

	input::placeholder {
		color: var(--muted);
	}

	button {
		min-height: 2.35rem;
		display: inline-grid;
		place-items: center;
		padding: 0.55rem 0.85rem;
		border: 0;
		border-radius: calc(var(--radius-md) - 0.2rem);
		background: var(--archive);
		color: white;
		font-weight: 720;
		cursor: pointer;
		transform: translateY(0) scale(1);
		transition:
			background-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-base) var(--ease-standard),
			transform var(--motion-fast) var(--ease-emphasized);
	}

	button:active {
		box-shadow: none;
		transform: translateY(1px) scale(0.96);
		transition-duration: var(--motion-instant);
	}

	.submit-icon {
		display: none;
		width: 1.1rem;
		height: 1.1rem;
		stroke: currentColor;
	}

	@media (hover: hover) and (pointer: fine) {
		button:hover {
			background: var(--archive-strong);
			box-shadow: 0 0.35rem 0.9rem rgb(var(--ink-rgb) / 10%);
			transform: translateY(-1px);
		}

		button:active {
			box-shadow: none;
			transform: translateY(1px) scale(0.96);
		}
	}

	@media (max-width: 520px) {
		button {
			width: 2.4rem;
			padding-inline: 0;
		}

		.submit-label {
			display: none;
		}

		.submit-icon {
			display: block;
		}
	}
</style>
