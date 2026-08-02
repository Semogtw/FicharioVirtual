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
	<svg aria-hidden="true" viewBox="0 0 24 24">
		<path d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
	</svg>
	<input id="global-search" bind:value={query} {placeholder} autocomplete="off" />
	<button type="submit" aria-label="Executar pesquisa">Buscar</button>
</form>

<style>
	form {
		width: min(100%, 48rem);
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		min-height: 3rem;
		padding: 0.3rem 0.35rem 0.3rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface-strong);
		box-shadow: 0 0.25rem 1rem rgb(32 33 36 / 5%);
	}

	svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: var(--muted);
		stroke-linecap: round;
		stroke-width: 1.8;
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
		color: #7a827e;
	}

	button {
		min-height: 2.35rem;
		padding: 0.55rem 0.85rem;
		border: 0;
		border-radius: calc(var(--radius-md) - 0.2rem);
		background: var(--archive);
		color: white;
		font-weight: 720;
		cursor: pointer;
	}

	@media (max-width: 520px) {
		button {
			width: 2.4rem;
			padding-inline: 0;
			font-size: 0;
		}

		button::after {
			content: '↵';
			font-size: 1rem;
		}
	}
</style>
