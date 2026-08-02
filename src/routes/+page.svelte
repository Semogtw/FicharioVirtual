<svelte:head>
	<title>Fichário Virtual</title>
</svelte:head>

<main aria-labelledby="page-title">
	<section class="hero">
		<p class="eyebrow">Biblioteca pessoal pesquisável</p>
		<h1 id="page-title">Fichário Virtual</h1>
		<p class="summary">
			Preserve imagens e PDFs de anotações, encontre a página certa por texto e mantenha o
			arquivo original sempre ao alcance.
		</p>

		<div class="status" role="status">
			<span class="status-mark" aria-hidden="true"></span>
			<div>
				<strong>Fundação em construção</strong>
				<p>A biblioteca, a importação e a leitura automática serão habilitadas por etapas.</p>
			</div>
		</div>
	</section>

	<section class="principles" aria-labelledby="principles-title">
		<h2 id="principles-title">O que orienta o projeto</h2>
		<ul>
			<li>O original é preservado e continua sendo a fonte principal.</li>
			<li>PDFs com texto não consomem leitura automática.</li>
			<li>Nenhum serviço pode ativar cobrança automaticamente.</li>
		</ul>
	</section>
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: #f7f4ee;
		color: #202124;
		font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	main {
		min-height: 100vh;
		display: grid;
		align-content: center;
		gap: clamp(2rem, 7vw, 6rem);
		padding: clamp(2rem, 7vw, 7rem);
		background:
			linear-gradient(90deg, rgb(83 106 91 / 8%) 1px, transparent 1px) 0 0 / 4rem 4rem,
			#f7f4ee;
	}

	.hero,
	.principles {
		max-width: 58rem;
	}

	.eyebrow {
		margin: 0 0 0.75rem;
		color: #536a5b;
		font-size: 0.8rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1,
	h2 {
		font-family: Georgia, Cambria, 'Times New Roman', serif;
		font-weight: 500;
	}

	h1 {
		margin: 0;
		font-size: clamp(3.25rem, 11vw, 7.5rem);
		line-height: 0.92;
		letter-spacing: -0.055em;
	}

	.summary {
		max-width: 44rem;
		margin: 1.5rem 0 0;
		color: #4f5854;
		font-size: clamp(1.1rem, 2vw, 1.45rem);
		line-height: 1.6;
	}

	.status {
		display: flex;
		gap: 1rem;
		max-width: 37rem;
		margin-top: 2.5rem;
		padding: 1.25rem 1.35rem;
		border: 1px solid #ddd7cc;
		border-radius: 0.8rem;
		background: #fcfaf6;
		box-shadow: 0 1rem 3rem rgb(32 33 36 / 7%);
	}

	.status-mark {
		width: 0.75rem;
		height: 0.75rem;
		margin-top: 0.35rem;
		border-radius: 50%;
		background: #a65e43;
		box-shadow: 0 0 0 0.35rem rgb(166 94 67 / 12%);
		flex: 0 0 auto;
	}

	.status strong {
		font-size: 1rem;
	}

	.status p {
		margin: 0.3rem 0 0;
		color: #66706b;
		line-height: 1.5;
	}

	.principles {
		padding-top: 2rem;
		border-top: 1px solid #d5cec1;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: clamp(1.5rem, 3vw, 2.25rem);
	}

	ul {
		display: grid;
		gap: 0.65rem;
		margin: 0;
		padding-left: 1.2rem;
		color: #4f5854;
		line-height: 1.55;
	}

	@media (min-width: 800px) {
		main {
			grid-template-columns: minmax(0, 1.8fr) minmax(18rem, 0.8fr);
			align-items: end;
		}

		.principles {
			padding: 2rem 0 0 2rem;
			border-top: 0;
			border-left: 1px solid #d5cec1;
		}
	}
</style>
