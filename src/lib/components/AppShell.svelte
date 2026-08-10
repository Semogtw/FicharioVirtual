<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import MobileNavigation from './MobileNavigation.svelte';
	import NavigationIcon from './NavigationIcon.svelte';
	import TopSearch from './TopSearch.svelte';

	interface AppShellProps {
		children: Snippet;
	}

	let { children }: AppShellProps = $props();
	let searchQuery = $derived(
		page.url.pathname.startsWith('/search')
			? (page.url.searchParams.get('q')?.slice(0, 200) ?? '')
			: ''
	);

	const navigation = [
		{ href: '/', label: 'Início', icon: 'home' },
		{ href: '/library/', label: 'Biblioteca', icon: 'library' },
		{ href: '/notebooks/', label: 'Cadernos', icon: 'notebooks' },
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

	function search(query: string) {
		void goto(`/search/?q=${encodeURIComponent(query)}`);
	}
</script>

<a class="skip-link" href="#main-content">Ir para o conteúdo</a>

<div class="shell">
	<aside class="sidebar">
		<a class="brand" href="/" aria-label="Fichário Virtual — início">
			<span class="brand-mark" aria-hidden="true">FV</span>
			<span class="brand-copy">
				<strong>Fichário</strong>
				<small>Virtual</small>
			</span>
		</a>

		<nav aria-label="Navegação principal">
			{#each navigation as item}
				<a
					href={item.href}
					class:active={isCurrent(item.href)}
					aria-current={isCurrent(item.href) ? 'page' : undefined}
				>
					<span class="nav-mark"><NavigationIcon name={item.icon} /></span>
					<span class="nav-label">{item.label}</span>
				</a>
			{/each}
		</nav>

		<a
			class="settings"
			class:active={isCurrent('/settings/')}
			href="/settings/"
			aria-current={isCurrent('/settings/') ? 'page' : undefined}
		>
			<span class="nav-mark"><NavigationIcon name="settings" /></span>
			<span class="nav-label">Configurações</span>
		</a>
	</aside>

	<div class="workspace">
		<header class="topbar">
			<TopSearch initialValue={searchQuery} onSearch={search} />
			<a class="profile-link" href="/settings/" aria-label="Abrir configurações">A</a>
		</header>

		<main id="main-content">
			<div class="content">{@render children()}</div>
		</main>
	</div>

	<MobileNavigation />
</div>

<style>
	.skip-link {
		position: fixed;
		z-index: 100;
		top: 0.75rem;
		left: 0.75rem;
		padding: 0.7rem 1rem;
		border-radius: var(--radius-sm);
		background: var(--ink);
		color: white;
		font-weight: 700;
		transform: translateY(-150%);
		transition: transform 120ms ease;
	}

	.skip-link:focus {
		transform: translateY(0);
	}

	.shell {
		min-height: 100vh;
	}

	.sidebar {
		display: none;
	}

	.workspace {
		min-width: 0;
	}

	.topbar {
		position: sticky;
		z-index: 10;
		top: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: var(--topbar-height);
		padding: 1rem;
		border-bottom: 1px solid rgb(var(--line-rgb) / 78%);
		background: rgb(var(--paper-rgb) / 92%);
		backdrop-filter: blur(0.9rem);
	}

	.profile-link {
		width: 2.7rem;
		height: 2.7rem;
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		border: 1px solid var(--line-strong);
		border-radius: 50%;
		background: var(--surface-strong);
		color: var(--archive);
		font-family: var(--font-heading);
		font-size: 1.1rem;
		font-weight: 700;
	}

	main {
		min-height: calc(100vh - var(--topbar-height));
		padding: 1.25rem 1rem calc(var(--mobile-nav-height) + 1.25rem);
	}

	.content {
		width: min(100%, var(--content-max));
		margin-inline: auto;
	}

	@media (min-width: 768px) {
		.shell {
			display: grid;
			grid-template-columns: var(--sidebar-compact) minmax(0, 1fr);
		}

		.sidebar {
			position: sticky;
			top: 0;
			display: flex;
			flex-direction: column;
			align-items: stretch;
			height: 100vh;
			padding: 1rem 0.65rem;
			border-right: 1px solid var(--line);
			background: var(--surface);
		}

		.brand {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 3.25rem;
			margin-bottom: 1.25rem;
			border-radius: var(--radius-md);
		}

		.brand-mark {
			width: 2.65rem;
			height: 2.65rem;
			display: grid;
			place-items: center;
			border-radius: 0.7rem;
			background: var(--archive);
			color: white;
			font-family: var(--font-heading);
			font-size: 0.85rem;
			font-weight: 700;
			letter-spacing: -0.04em;
		}

		.brand-copy,
		.nav-label {
			display: none;
		}

		.sidebar nav {
			display: grid;
			gap: 0.35rem;
		}

		.sidebar nav a,
		.settings {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 3.25rem;
			border-radius: var(--radius-sm);
			color: var(--muted);
		}

		.sidebar nav a:hover,
		.settings:hover,
		.sidebar nav a.active,
		.settings.active {
			background: var(--archive-soft);
			color: var(--archive);
		}

		.sidebar nav a.active,
		.settings.active {
			font-weight: 760;
		}

		.nav-mark {
			display: grid;
			place-items: center;
			width: 1.4rem;
			height: 1.4rem;
		}

		.settings {
			margin-top: auto;
		}

		.topbar {
			padding-inline: clamp(1.25rem, 3vw, 2.5rem);
		}

		main {
			padding: clamp(1.5rem, 3vw, 3rem);
		}
	}

	@media (min-width: 1100px) {
		.shell {
			grid-template-columns: var(--sidebar-wide) minmax(0, 1fr);
		}

		.sidebar {
			padding: 1.25rem 1rem;
		}

		.brand {
			justify-content: flex-start;
			gap: 0.75rem;
			padding-inline: 0.35rem;
		}

		.brand-copy {
			display: grid;
			line-height: 1.05;
		}

		.brand-copy strong {
			font-family: var(--font-heading);
			font-size: 1.15rem;
			font-weight: 600;
		}

		.brand-copy small {
			color: var(--muted);
			font-size: 0.76rem;
		}

		.sidebar nav a,
		.settings {
			justify-content: flex-start;
			gap: 0.85rem;
			padding-inline: 0.9rem;
		}

		.nav-label {
			display: inline;
			font-size: 0.94rem;
			font-weight: 680;
		}
	}
</style>
