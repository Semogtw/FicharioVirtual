<script lang="ts">
	import { page } from '$app/state';
	import NavigationIcon from './NavigationIcon.svelte';

	const primaryNavigation = [
		{ href: '/', label: 'Início', icon: 'home' },
		{ href: '/library/', label: 'Biblioteca', icon: 'library' },
		{ href: '/notebooks/', label: 'Cadernos', icon: 'notebooks' },
		{ href: '/import/', label: 'Importar', icon: 'import' }
	] as const;

	const moreNavigation = [
		{ href: '/review/', label: 'Revisar', icon: 'review' },
		{ href: '/coverage/', label: 'Cobertura', icon: 'coverage' },
		{ href: '/drive/', label: 'Google Drive', icon: 'drive' },
		{ href: '/settings/', label: 'Configurações', icon: 'settings' }
	] as const;

	function normalizePath(pathname: string) {
		const normalized = pathname.replace(/\/+$/, '');
		return normalized || '/';
	}

	function isCurrent(href: string) {
		const pathname = normalizePath(page.url.pathname);
		const target = normalizePath(href);
		return target === '/'
			? pathname === '/'
			: pathname === target || pathname.startsWith(`${target}/`);
	}

	function isMoreCurrent() {
		return moreNavigation.some((item) => isCurrent(item.href));
	}
</script>

<nav class="mobile-navigation" aria-label="Navegação principal">
	{#each primaryNavigation as item}
		<a
			href={item.href}
			aria-label={item.label}
			class:active={isCurrent(item.href)}
			aria-current={isCurrent(item.href) ? 'page' : undefined}
		>
			<span class="icon"><NavigationIcon name={item.icon} /></span>
			<small>{item.label}</small>
		</a>
	{/each}

	<details class:active={isMoreCurrent()}>
		<summary aria-label="Abrir mais opções de navegação">
			<span class="icon"><NavigationIcon name="more" /></span>
			<small>Mais</small>
		</summary>
		<div class="more-panel">
			<p>Mais opções</p>
			{#each moreNavigation as item}
				<a
					href={item.href}
					class:active={isCurrent(item.href)}
					aria-current={isCurrent(item.href) ? 'page' : undefined}
				>
					<span class="panel-icon"><NavigationIcon name={item.icon} /></span>
					<span>{item.label}</span>
				</a>
			{/each}
		</div>
	</details>
</nav>

<style>
	.mobile-navigation {
		position: fixed;
		z-index: 20;
		inset: auto 0 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		min-height: var(--mobile-nav-height);
		padding: 0.4rem max(0.35rem, env(safe-area-inset-right))
			max(0.4rem, env(safe-area-inset-bottom)) max(0.35rem, env(safe-area-inset-left));
		border-top: 1px solid var(--line);
		background: rgb(var(--surface-rgb) / 96%);
		backdrop-filter: blur(0.75rem);
		transition:
			background-color var(--motion-slow) var(--ease-soft),
			border-color var(--motion-slow) var(--ease-soft);
	}

	.mobile-navigation > a,
	details > summary {
		position: relative;
		isolation: isolate;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 0.15rem;
		min-width: 0;
		min-height: 3.5rem;
		border-radius: var(--radius-sm);
		color: var(--muted);
		touch-action: manipulation;
		transform: scale(1);
		transition:
			color var(--motion-fast) var(--ease-standard),
			transform var(--motion-base) var(--ease-emphasized);
	}

	details {
		position: relative;
		min-width: 0;
	}

	details > summary {
		width: 100%;
		height: 100%;
		cursor: pointer;
		list-style: none;
	}

	details > summary::-webkit-details-marker {
		display: none;
	}

	.mobile-navigation > a::before,
	details > summary::before {
		position: absolute;
		z-index: -1;
		inset: 0.16rem 0.1rem;
		content: '';
		border-radius: calc(var(--radius-sm) - 0.05rem);
		background: var(--archive-soft);
		opacity: 0;
		transform: scale(0.84);
		transition:
			opacity var(--motion-fast) var(--ease-standard),
			transform var(--motion-base) var(--ease-emphasized);
	}

	.mobile-navigation > a:active,
	details > summary:active {
		color: var(--archive);
		transform: scale(0.94);
		transition-duration: var(--motion-instant);
	}

	.mobile-navigation > a:active::before,
	.mobile-navigation > a.active::before,
	details[open] > summary::before,
	details.active > summary::before {
		opacity: 1;
		transform: scale(1);
	}

	.mobile-navigation > a.active,
	details[open] > summary,
	details.active > summary {
		color: var(--archive);
		font-weight: 760;
	}

	.icon {
		display: grid;
		place-items: center;
		transform: translateY(0) scale(1);
		transition: transform var(--motion-base) var(--ease-emphasized);
	}

	.mobile-navigation > a.active .icon,
	details[open] > summary .icon,
	details.active > summary .icon {
		transform: translateY(-1px) scale(1.1);
	}

	small {
		max-width: 100%;
		overflow: hidden;
		font-size: 0.7rem;
		font-weight: 720;
		text-overflow: ellipsis;
		white-space: nowrap;
		transform: translateY(0);
		transition: transform var(--motion-base) var(--ease-emphasized);
	}

	.mobile-navigation > a.active small,
	details[open] > summary small,
	details.active > summary small {
		transform: translateY(1px);
	}

	.more-panel {
		position: absolute;
		right: 0;
		bottom: calc(100% + 0.75rem);
		width: min(18rem, calc(100vw - 1rem));
		display: grid;
		gap: 0.25rem;
		padding: 0.55rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: rgb(var(--surface-rgb) / 98%);
		box-shadow: var(--shadow-raised);
		backdrop-filter: blur(1rem);
		transform-origin: 90% 100%;
		animation: more-panel-enter var(--motion-base) var(--ease-emphasized) both;
	}

	.more-panel p {
		margin: 0;
		padding: 0.5rem 0.65rem 0.35rem;
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.more-panel a {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 3rem;
		padding: 0.65rem 0.75rem;
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: 0.9rem;
		font-weight: 680;
	}

	.more-panel a.active {
		background: var(--archive-soft);
		color: var(--archive);
		font-weight: 760;
	}

	.panel-icon {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		color: var(--archive);
	}

	@keyframes more-panel-enter {
		from {
			opacity: 0;
			transform: translateY(0.5rem) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (min-width: 768px) {
		.mobile-navigation {
			display: none;
		}
	}
</style>
