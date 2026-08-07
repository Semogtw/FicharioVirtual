<script lang="ts">
	import { page } from '$app/state';
	import NavigationIcon from './NavigationIcon.svelte';

	const navigation = [
		{ href: '/', label: 'Início', icon: 'home' },
		{ href: '/library/', label: 'Biblioteca', icon: 'library' },
		{ href: '/import/', label: 'Importar', icon: 'import' },
		{ href: '/review/', label: 'Revisar', icon: 'review' },
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
			<NavigationIcon name={item.icon} />
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
		grid-template-columns: repeat(5, 1fr);
		min-height: var(--mobile-nav-height);
		padding: 0.4rem max(0.5rem, env(safe-area-inset-right)) max(0.4rem, env(safe-area-inset-bottom))
			max(0.5rem, env(safe-area-inset-left));
		border-top: 1px solid var(--line);
		background: rgb(var(--surface-rgb) / 96%);
		backdrop-filter: blur(0.75rem);
	}

	a {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 0.15rem;
		min-width: 3rem;
		min-height: 3.5rem;
		border-radius: var(--radius-sm);
		color: var(--muted);
	}

	a:active,
	a.active {
		background: var(--archive-soft);
		color: var(--archive);
	}

	a.active {
		font-weight: 760;
	}

	small {
		font-size: 0.7rem;
		font-weight: 720;
	}

	@media (min-width: 768px) {
		.mobile-navigation {
			display: none;
		}
	}
</style>
