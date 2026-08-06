<nav class="mobile-navigation" aria-label="Navegação principal">
	<a href="/" aria-label="Início">
		<span aria-hidden="true">⌂</span>
		<small>Início</small>
	</a>
	<a href="/library/" aria-label="Biblioteca">
		<span aria-hidden="true">▤</span>
		<small>Biblioteca</small>
	</a>
	<a class="import" href="/import/" aria-label="Importar">
		<span aria-hidden="true">＋</span>
		<small>Importar</small>
	</a>
	<a href="/review/" aria-label="Revisar">
		<span aria-hidden="true">✓</span>
		<small>Revisar</small>
	</a>
	<a href="/drive/" aria-label="Google Drive">
		<span aria-hidden="true">☁</span>
		<small>Drive</small>
	</a>
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

	a:active {
		background: var(--archive-soft);
	}

	span {
		font-size: 1.3rem;
		line-height: 1;
	}

	small {
		font-size: 0.7rem;
		font-weight: 720;
	}

	.import {
		color: var(--accent-strong);
	}

	@media (min-width: 768px) {
		.mobile-navigation {
			display: none;
		}
	}
</style>
