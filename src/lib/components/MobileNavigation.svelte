<script lang="ts">
	import { page } from '$app/state';
	import NavigationIcon from './NavigationIcon.svelte';

	const navigation = [
		{ href: '/', label: 'Início', icon: 'home' },
		{ href: '/library/', label: 'Biblioteca', icon: 'library' },
		{ href: '/import/', label: 'Importar', icon: 'import' },
		{ href: '/review/', label: 'Revisar', icon: 'review' },
		{ href: '/coverage/', label: 'Cobertura', icon: 'coverage' },
		{ href: '/drive/', label: 'Drive', icon: 'drive' }
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
</script>

<nav class="mobile-navigation" aria-label="Navegação principal">
	{#each navigation as item}
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
</nav>

<style>
	.mobile-navigation {
		position: fixed;
		z-index: 20;
		inset: auto 0 0;
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
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

	a {
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

	a::before {
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

	a:active {
		color: var(--archive);
		transform: scale(0.94);
		transition-duration: var(--motion-instant);
	}

	a:active::before,
	a.active::before {
		opacity: 1;
		transform: scale(1);
	}

	a.active {
		color: var(--archive);
		font-weight: 760;
	}

	.icon {
		display: grid;
		place-items: center;
		transform: translateY(0) scale(1);
		transition: transform var(--motion-base) var(--ease-emphasized);
	}

	a.active .icon {
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

	a.active small {
		transform: translateY(1px);
	}

	@media (min-width: 768px) {
		.mobile-navigation {
			display: none;
		}
	}
</style>
