<script lang="ts">
	import { onMount } from 'svelte';
	import {
		DEFAULT_THEME,
		THEMES,
		THEME_STORAGE_KEY,
		isThemeId,
		readStoredTheme,
		selectTheme as persistTheme,
		type ThemeId
	} from '$lib/theme/theme';

	let activeTheme = $state<ThemeId>(DEFAULT_THEME);

	function selectTheme(theme: ThemeId) {
		persistTheme(theme, localStorage, document);
		activeTheme = theme;
	}

	function navigateTheme(event: KeyboardEvent, themeId: ThemeId) {
		const currentIndex = THEMES.findIndex((theme) => theme.id === themeId);
		let nextIndex: number | null = null;

		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			nextIndex = (currentIndex + 1) % THEMES.length;
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			nextIndex = (currentIndex - 1 + THEMES.length) % THEMES.length;
		} else if (event.key === 'Home') {
			nextIndex = 0;
		} else if (event.key === 'End') {
			nextIndex = THEMES.length - 1;
		}

		if (nextIndex === null) return;
		event.preventDefault();

		const nextTheme = THEMES[nextIndex];
		selectTheme(nextTheme.id);
		requestAnimationFrame(() => {
			const nextButton = document.querySelector<HTMLButtonElement>(
				`[data-theme-option="${nextTheme.id}"]`
			);
			nextButton?.focus();
		});
	}

	onMount(() => {
		const rootTheme = document.documentElement.dataset.theme;
		activeTheme = isThemeId(rootTheme) ? rootTheme : readStoredTheme(localStorage);

		function syncTheme(event: StorageEvent) {
			if (event.key !== THEME_STORAGE_KEY) return;
			activeTheme = isThemeId(event.newValue) ? event.newValue : DEFAULT_THEME;
		}

		window.addEventListener('storage', syncTheme);
		return () => window.removeEventListener('storage', syncTheme);
	});
</script>

<section class="theme-picker" aria-labelledby="theme-title">
	<div class="theme-heading">
		<div>
			<p class="eyebrow">Aparência</p>
			<h2 id="theme-title">Cores do fichário</h2>
			<p>Escolha uma paleta. A estrutura editorial e a legibilidade permanecem iguais.</p>
		</div>
		<span class="current-theme" aria-live="polite">
			{THEMES.find((theme) => theme.id === activeTheme)?.name ?? 'Arquivo'}
		</span>
	</div>

	<div class="theme-grid" role="radiogroup" aria-labelledby="theme-title">
		{#each THEMES as theme (theme.id)}
			<button
				type="button"
				class:active={activeTheme === theme.id}
				role="radio"
				aria-checked={activeTheme === theme.id}
				tabindex={activeTheme === theme.id ? 0 : -1}
				data-theme-option={theme.id}
				onclick={() => selectTheme(theme.id)}
				onkeydown={(event) => navigateTheme(event, theme.id)}
			>
				<span class="option-copy">
					<strong>{theme.name}</strong>
					<small>{theme.description}</small>
				</span>
				<span class="swatches" aria-hidden="true">
					{#each theme.swatches as swatch}
						<span class="swatch" style={`--swatch: ${swatch}`}></span>
					{/each}
				</span>
				<span class="check" aria-hidden="true">{activeTheme === theme.id ? '✓' : ''}</span>
			</button>
		{/each}
	</div>
</section>

<style>
	.theme-picker {
		display: grid;
		gap: 1rem;
		padding: clamp(1rem, 2.5vw, 1.35rem);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background:
			linear-gradient(135deg, rgb(var(--archive-rgb) / 5%), transparent 48%), var(--surface);
		box-shadow: var(--shadow-soft);
	}

	.theme-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.eyebrow {
		margin-bottom: 0.35rem;
		color: var(--archive);
		font-size: 0.72rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h2 {
		margin-bottom: 0.3rem;
		font-family: var(--font-heading);
		font-size: clamp(1.45rem, 3vw, 1.85rem);
		font-weight: 540;
	}

	.theme-heading p:last-child {
		max-width: 48rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.5;
	}

	.current-theme {
		flex: 0 0 auto;
		padding: 0.42rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: 99rem;
		background: var(--surface-strong);
		color: var(--archive);
		font-size: 0.76rem;
		font-weight: 760;
	}

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	button {
		position: relative;
		min-width: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.85rem;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: rgb(var(--surface-rgb) / 80%);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease,
			transform 120ms ease;
	}

	button.active {
		border-color: var(--archive);
		box-shadow: inset 0 0 0 1px var(--archive);
	}

	.option-copy {
		min-width: 0;
		display: grid;
		gap: 0.25rem;
	}

	.option-copy strong {
		font-family: var(--font-heading);
		font-size: 1.08rem;
		font-weight: 620;
	}

	.option-copy small {
		color: var(--muted);
		font-size: 0.76rem;
		line-height: 1.35;
	}

	.swatches {
		display: flex;
		align-items: center;
		padding-right: 1.2rem;
	}

	.swatch {
		width: 1.7rem;
		height: 1.7rem;
		margin-left: -0.4rem;
		border: 2px solid var(--surface-strong);
		border-radius: 50%;
		background: var(--swatch);
		box-shadow: 0 0 0 1px rgb(var(--ink-rgb) / 12%);
	}

	.swatch:first-child {
		margin-left: 0;
	}

	.check {
		position: absolute;
		top: 0.55rem;
		right: 0.6rem;
		width: 1.15rem;
		height: 1.15rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--archive);
		color: white;
		font-size: 0.72rem;
		font-weight: 800;
	}

	button:not(.active) .check {
		background: transparent;
	}

	@media (hover: hover) and (pointer: fine) {
		button:hover {
			border-color: var(--line-strong);
			box-shadow: 0 0.5rem 1.4rem rgb(var(--ink-rgb) / 7%);
			transform: translateY(-0.08rem);
		}
	}

	@media (max-width: 760px) {
		.theme-heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.theme-grid {
			grid-template-columns: 1fr;
		}

		.current-theme {
			align-self: flex-start;
		}
	}
</style>
