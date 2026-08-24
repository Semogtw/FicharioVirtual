<svelte:head>
	<title>Fichário Virtual — seu arquivo, pesquisável</title>
	<meta
		name="description"
		content="Organize imagens e PDFs em um fichário pessoal, preserve os originais e encontre qualquer página quando precisar."
	/>
</svelte:head>

<main class="landing" aria-labelledby="landing-title">
	<header class="masthead">
		<a class="brand" href="/" aria-label="Fichário Virtual — início">
			<span class="brand-mark" aria-hidden="true">FV</span>
			<span class="brand-name">Fichário Virtual</span>
		</a>
		<nav aria-label="Navegação pública">
			<a href="#como-funciona">Como funciona</a>
			<a href="/privacy/">Privacidade</a>
			<a class="nav-action" href="/login/?mode=sign_up">Criar conta</a>
		</nav>
	</header>

	<section class="hero">
		<div class="hero-copy">
			<p class="eyebrow">Um lugar para o que você não quer perder</p>
			<h1 id="landing-title">Seu arquivo não cabe numa pasta.</h1>
			<p class="hero-summary">
				O Fichário transforma imagens, PDFs e anotações soltas em um arquivo pessoal que você
				consegue consultar de verdade — sem esconder o original.
			</p>
			<div class="hero-actions">
				<a class="primary-action" href="/login/?mode=sign_up"
					>Criar conta gratuitamente <span aria-hidden="true">↗</span></a
				>
				<a class="quiet-action" href="/login/"
					>Já tenho uma conta <span aria-hidden="true">→</span></a
				>
			</div>
			<p class="quiet-note">
				Conta por e-mail · seus arquivos continuam no seu próprio Google Drive
			</p>
		</div>

		<aside class="archive-preview" aria-label="Prévia do seu arquivo no Fichário">
			<div class="preview-topline">
				<span>FICHÁRIO / 001</span>
				<span aria-hidden="true">•••</span>
			</div>
			<div class="paper-stack" aria-hidden="true">
				<div class="paper paper-back"></div>
				<div class="paper paper-middle"></div>
				<div class="paper paper-front">
					<span class="paper-label">PÁGINA ENCONTRADA</span>
					<strong>Notas de campo</strong>
					<span class="paper-rule"></span>
					<span class="paper-line wide"></span>
					<span class="paper-line"></span>
					<span class="paper-line short"></span>
					<span class="paper-stamp">12<br />JUN</span>
				</div>
			</div>
			<div class="preview-caption">
				<span>Texto preparado para pesquisa</span>
				<strong>1 de 24 páginas</strong>
			</div>
		</aside>
	</section>

	<section class="signal-row" aria-label="O que você ganha">
		<div><strong>Seu Drive</strong><span>originais sob seu controle</span></div>
		<div><strong>Seu fichário</strong><span>uma conta, uma biblioteca</span></div>
		<div><strong>Seu tempo</strong><span>menos caça, mais encontro</span></div>
	</section>

	<section id="como-funciona" class="feature-section" aria-labelledby="feature-title">
		<div class="section-intro">
			<p class="eyebrow">Da captura ao encontro</p>
			<h2 id="feature-title">A página continua sendo a unidade de memória.</h2>
			<p>
				O Fichário cuida da parte invisível — leitura, organização e indexação — para você voltar ao
				que importa com contexto.
			</p>
		</div>
		<div class="feature-grid">
			<article class="feature-card feature-card-large">
				<span class="feature-number">01</span>
				<h3>Guarde sem desmontar</h3>
				<p>
					Importe imagens e PDFs. O original é preservado enquanto o conteúdo ganha uma camada
					pesquisável.
				</p>
				<div class="feature-tag">IMAGEM · PDF · DRIVE</div>
			</article>
			<article class="feature-card">
				<span class="feature-number">02</span>
				<h3>Encontre do seu jeito</h3>
				<p>Buscar por texto, erro de escrita ou significado.</p>
				<div class="feature-tag">TEXTO · FUZZY · SEMÂNTICA</div>
			</article>
			<article class="feature-card accent-card">
				<span class="feature-number">03</span>
				<h3>Organize quando fizer sentido</h3>
				<p>Cadernos, tags e revisão ficam perto da página, não escondidos em outra ferramenta.</p>
				<div class="feature-tag">CADERNOS · TAGS · REVISÃO</div>
			</article>
		</div>
	</section>

	<section class="closing-callout" aria-labelledby="closing-title">
		<div>
			<p class="eyebrow">Comece pelo que já existe</p>
			<h2 id="closing-title">Seu próximo encontro com um documento pode ser uma busca.</h2>
		</div>
		<a class="primary-action" href="/login/?mode=sign_up"
			>Abrir meu fichário <span aria-hidden="true">↗</span></a
		>
	</section>

	<footer class="footer">
		<span>Fichário Virtual · uso experimental</span>
		<nav aria-label="Links institucionais">
			<a href="https://github.com/Semogtw/FicharioVirtual" target="_blank" rel="noreferrer"
				>Código no GitHub</a
			>
			<a href="/privacy/">Privacidade</a>
			<a href="/terms/">Termos de uso</a>
			<a href="/login/">Entrar</a>
		</nav>
	</footer>
</main>

<style>
	.landing {
		--landing-ink: #202124;
		--landing-paper: #f7f4ee;
		--landing-green: #536a5b;
		--landing-line: #ddd7cc;
		max-width: 92rem;
		margin: 0 auto;
		padding: 1.25rem clamp(1.25rem, 4vw, 4.75rem) 2rem;
		color: var(--landing-ink);
	}

	.masthead,
	.footer,
	.hero-actions,
	.preview-topline,
	.preview-caption,
	.signal-row,
	.closing-callout {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.masthead {
		min-height: 4rem;
		border-bottom: 1px solid var(--landing-line);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.7rem;
		font-weight: 700;
	}

	.brand-mark {
		display: grid;
		width: 2.35rem;
		height: 2.35rem;
		place-items: center;
		border-radius: 0.55rem;
		background: var(--landing-green);
		color: white;
		font-family: var(--font-heading);
		font-size: 0.72rem;
		letter-spacing: 0.04em;
	}

	.brand-name {
		font-family: var(--font-heading);
		font-size: 1.05rem;
		font-weight: 600;
	}

	nav {
		display: flex;
		align-items: center;
		gap: clamp(0.8rem, 2.5vw, 2rem);
		font-size: 0.82rem;
	}

	nav a {
		color: var(--muted);
		font-weight: 650;
	}

	nav a:hover,
	.quiet-action:hover,
	.footer a:hover {
		color: var(--landing-green);
	}

	.nav-action {
		padding: 0.65rem 0.85rem;
		border: 1px solid var(--landing-green);
		border-radius: 999px;
		color: var(--landing-green);
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(20rem, 0.95fr);
		align-items: center;
		gap: clamp(2.5rem, 8vw, 8rem);
		min-height: min(48rem, 72vh);
		padding: clamp(4.5rem, 10vw, 9rem) 0 clamp(4rem, 8vw, 7rem);
	}

	.eyebrow {
		margin-bottom: 0.8rem;
		color: var(--landing-green);
		font-size: 0.72rem;
		font-weight: 780;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	h1,
	h2,
	h3 {
		font-family: var(--font-heading);
		font-weight: 520;
		letter-spacing: -0.045em;
	}

	h1 {
		max-width: 48rem;
		margin-bottom: 1.5rem;
		font-size: clamp(3.6rem, 8vw, 7.8rem);
		line-height: 0.88;
	}

	.hero-summary {
		max-width: 38rem;
		margin-bottom: 2rem;
		color: var(--muted);
		font-size: clamp(1.05rem, 1.7vw, 1.25rem);
		line-height: 1.65;
	}

	.hero-actions {
		justify-content: flex-start;
		flex-wrap: wrap;
	}

	.primary-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.7rem;
		min-height: 3rem;
		padding: 0.8rem 1rem;
		border-radius: 0.55rem;
		background: var(--landing-green);
		color: white;
		font-weight: 750;
		box-shadow: 0 0.8rem 1.8rem rgb(var(--archive-rgb) / 18%);
	}

	.primary-action:hover {
		background: var(--archive-strong);
	}

	.quiet-action {
		color: var(--muted);
		font-weight: 720;
	}

	.quiet-note {
		margin: 1rem 0 0;
		color: var(--muted);
		font-size: 0.78rem;
	}

	.archive-preview {
		position: relative;
		min-height: 30rem;
		padding: 1.15rem;
		border: 1px solid var(--landing-line);
		border-radius: 1rem;
		background: #e7e5dd;
		box-shadow: 1rem 1.2rem 0 rgb(83 106 91 / 12%);
		transform: rotate(2.5deg);
	}

	.archive-preview::before {
		position: absolute;
		inset: 0.65rem;
		border: 1px dashed rgb(83 106 91 / 34%);
		border-radius: 0.7rem;
		content: '';
		pointer-events: none;
	}

	.preview-topline,
	.preview-caption {
		position: relative;
		z-index: 1;
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 750;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.preview-caption {
		align-items: flex-end;
		margin-top: 1.2rem;
		letter-spacing: 0;
		text-transform: none;
	}

	.preview-caption strong {
		color: var(--landing-green);
		font-size: 0.75rem;
	}

	.paper-stack {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 23rem;
		margin-top: 1.25rem;
	}

	.paper {
		position: absolute;
		width: min(78%, 18rem);
		height: 22rem;
		border: 1px solid #d7d1c4;
		border-radius: 0.25rem;
		box-shadow: 0.8rem 1rem 1.5rem rgb(32 33 36 / 11%);
	}

	.paper-back {
		background: #cfb18e;
		transform: translate(1rem, -0.4rem) rotate(-7deg);
	}

	.paper-middle {
		background: #dbe4dc;
		transform: translate(-0.75rem, 0.3rem) rotate(5deg);
	}

	.paper-front {
		display: grid;
		align-content: start;
		gap: 0.8rem;
		padding: 2rem 1.45rem;
		background: var(--landing-paper);
		transform: rotate(-1deg);
	}

	.paper-label,
	.feature-tag {
		color: var(--landing-green);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.1em;
	}

	.paper-front strong {
		font-family: var(--font-heading);
		font-size: 1.7rem;
		font-weight: 520;
	}

	.paper-rule {
		width: 100%;
		height: 1px;
		margin: 0.7rem 0 0.2rem;
		background: var(--landing-line);
	}

	.paper-line {
		width: 85%;
		height: 0.45rem;
		border-radius: 99px;
		background: #d7d1c4;
	}

	.paper-line.wide {
		width: 95%;
	}

	.paper-line.short {
		width: 58%;
	}

	.paper-stamp {
		align-self: end;
		justify-self: end;
		margin-top: 1.2rem;
		padding: 0.35rem;
		border: 1px solid var(--landing-green);
		border-radius: 50%;
		color: var(--landing-green);
		font-size: 0.61rem;
		font-weight: 800;
		line-height: 1.1;
		text-align: center;
		transform: rotate(8deg);
	}

	.signal-row {
		align-items: stretch;
		border-top: 1px solid var(--landing-line);
		border-bottom: 1px solid var(--landing-line);
	}

	.signal-row > div {
		display: grid;
		gap: 0.25rem;
		flex: 1;
		padding: 1.4rem 1rem 1.4rem 0;
	}

	.signal-row > div + div {
		padding-left: clamp(1rem, 4vw, 4rem);
		border-left: 1px solid var(--landing-line);
	}

	.signal-row strong {
		font-family: var(--font-heading);
		font-size: 1.15rem;
		font-weight: 520;
	}

	.signal-row span {
		color: var(--muted);
		font-size: 0.78rem;
	}

	.feature-section {
		display: grid;
		grid-template-columns: minmax(14rem, 0.7fr) minmax(0, 1.3fr);
		gap: clamp(3rem, 8vw, 9rem);
		padding: clamp(5rem, 10vw, 9rem) 0;
	}

	.section-intro h2,
	.closing-callout h2 {
		max-width: 31rem;
		margin-bottom: 1rem;
		font-size: clamp(2.4rem, 4.5vw, 4.5rem);
		line-height: 0.97;
	}

	.section-intro > p:last-child {
		max-width: 25rem;
		margin: 0;
		color: var(--muted);
		line-height: 1.65;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.feature-card {
		display: grid;
		align-content: space-between;
		gap: 1.25rem;
		min-height: 17rem;
		padding: 1.35rem;
		border: 1px solid var(--landing-line);
		border-radius: 0.75rem;
		background: #fbfaf6;
	}

	.feature-card-large {
		grid-row: span 2;
		min-height: 35rem;
		background: var(--landing-green);
		color: white;
	}

	.feature-card-large .feature-number,
	.feature-card-large .feature-tag {
		color: #c8d8ca;
	}

	.accent-card {
		background: #e8d6bd;
	}

	.feature-number {
		color: var(--landing-green);
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.1em;
	}

	.feature-card h3 {
		margin: 0;
		font-size: clamp(1.7rem, 3vw, 2.7rem);
		line-height: 0.98;
	}

	.feature-card p {
		margin: 0;
		max-width: 24rem;
		color: inherit;
		opacity: 0.78;
		line-height: 1.55;
	}

	.feature-tag {
		align-self: end;
	}

	.closing-callout {
		align-items: flex-end;
		padding: clamp(2rem, 5vw, 4rem);
		border-radius: 1rem;
		background: #dbe4dc;
	}

	.closing-callout h2 {
		margin-bottom: 0;
	}

	.footer {
		align-items: flex-start;
		padding-top: 1.5rem;
		color: var(--muted);
		font-size: 0.74rem;
	}

	.footer nav {
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem 1.2rem;
	}

	@media (max-width: 820px) {
		.masthead nav a:not(.nav-action) {
			display: none;
		}

		.hero,
		.feature-section {
			grid-template-columns: 1fr;
		}

		.hero {
			min-height: 0;
			padding-top: 5rem;
		}

		.archive-preview {
			max-width: 30rem;
			width: 100%;
			margin: 0 auto;
		}

		.feature-section {
			gap: 2.5rem;
		}
	}

	@media (max-width: 560px) {
		.landing {
			padding-inline: 1rem;
		}

		.brand-name {
			display: none;
		}

		h1 {
			font-size: clamp(3.3rem, 17vw, 5.2rem);
		}

		.signal-row,
		.closing-callout,
		.footer {
			align-items: flex-start;
			flex-direction: column;
		}

		.signal-row > div,
		.signal-row > div + div {
			width: 100%;
			padding: 1rem 0;
			border-left: 0;
		}

		.signal-row > div + div {
			border-top: 1px solid var(--landing-line);
		}

		.feature-grid {
			grid-template-columns: 1fr;
		}

		.feature-card-large {
			grid-row: auto;
			min-height: 20rem;
		}

		.footer nav {
			justify-content: flex-start;
		}
	}
</style>
