<svelte:head>
	<title>Privacidade — Fichário Virtual</title>
	<meta
		name="description"
		content="Como o Fichário Virtual separa seus dados, usa o Google Drive e trata pedidos de exclusão."
	/>
</svelte:head>

<main class="legal-page" aria-labelledby="page-title">
	<header class="legal-header">
		<a class="brand" href="/" aria-label="Voltar ao Fichário Virtual">
			<span>FV</span>
			<strong>Fichário Virtual</strong>
		</a>
		<a class="back-link" href="/">Voltar ao início</a>
	</header>

	<article class="legal-copy">
		<p class="eyebrow">Transparência primeiro</p>
		<h1 id="page-title">Privacidade</h1>
		<p class="lead">
			Esta página explica o que o Fichário Virtual precisa para funcionar e quais partes continuam
			sob seu controle. O produto está em uso experimental e esta política deve ser lida junto dos
			<a href="/terms/">Termos de uso</a>.
		</p>

		<section aria-labelledby="data-title">
			<h2 id="data-title">O que guardamos</h2>
			<p>
				A conta usa seu e-mail para autenticação. O Fichário guarda metadados da biblioteca,
				cadernos, tags, páginas, estados de importação e resultados derivados necessários para
				pesquisa e revisão.
			</p>
			<p>
				Os dados são isolados por conta no banco. Uma conta não deve conseguir listar, pesquisar,
				alterar ou processar documentos de outra conta.
			</p>
		</section>

		<section aria-labelledby="drive-title">
			<h2 id="drive-title">Google Drive e originais</h2>
			<p>
				Quando você conecta o Google Drive, o Fichário usa a autorização concedida para encontrar e
				ler seus arquivos no fluxo de importação. Os arquivos originais permanecem no seu próprio
				Drive; o Fichário não os transforma em um acervo público.
			</p>
			<p>
				Você pode desconectar o Drive nas configurações. Desconectar interrompe o acesso futuro e
				remove a conexão armazenada pelo Fichário; não apaga arquivos do seu Google Drive.
			</p>
		</section>

		<section aria-labelledby="providers-title">
			<h2 id="providers-title">Processamento e provedores</h2>
			<p>
				O processamento depende do tipo de conta. Contas owner podem usar o pipeline Gemini
				configurado para o produto. Contas public usam o OCR Azure Read v3.2 e não têm acesso ao
				desktop OCR nem à quota Gemini reservada ao owner.
			</p>
			<p>
				Registramos telemetria operacional mínima, como provedor, modelo, páginas processadas,
				latência, fallback e necessidade de revisão. Não colocamos segredos nas respostas, no bundle
				do cliente ou nos logs de aplicação.
			</p>
		</section>

		<section aria-labelledby="control-title">
			<h2 id="control-title">Seus controles</h2>
			<p>
				Você pode exportar seus dados, desconectar o Google Drive e solicitar a exclusão da conta
				nas configurações. A exclusão remove a conta, os metadados e os derivados do Fichário e
				invalida a sessão; os originais que estejam no seu Drive continuam lá até que você decida
				removê-los.
			</p>
			<p>
				Se uma obrigação legal ou uma falha técnica impedir uma remoção imediata, o produto deve
				informar claramente o que ficou pendente e por quê.
			</p>
		</section>
	</article>

	<footer class="legal-footer">
		<a href="/terms/">Termos de uso</a>
		<a href="/login/">Entrar ou criar conta</a>
	</footer>
</main>

<style>
	.legal-page {
		max-width: 66rem;
		margin: 0 auto;
		padding: 1.25rem clamp(1.25rem, 5vw, 4rem) 3rem;
	}

	.legal-header,
	.legal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--line);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
	}

	.brand span {
		display: grid;
		width: 2.3rem;
		height: 2.3rem;
		place-items: center;
		border-radius: 0.55rem;
		background: var(--archive);
		color: white;
		font-family: var(--font-heading);
		font-size: 0.72rem;
		font-weight: 750;
	}

	.brand strong,
	h1,
	h2 {
		font-family: var(--font-heading);
		font-weight: 520;
	}

	.brand strong {
		font-size: 1.05rem;
	}

	.back-link,
	.legal-footer a,
	.legal-copy a {
		color: var(--archive);
		font-weight: 700;
	}

	.legal-copy {
		max-width: 48rem;
		padding: clamp(4rem, 9vw, 7rem) 0;
	}

	.eyebrow {
		margin-bottom: 0.75rem;
		color: var(--archive);
		font-size: 0.74rem;
		font-weight: 780;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}

	h1 {
		margin-bottom: 1.25rem;
		font-size: clamp(3.2rem, 8vw, 6rem);
		letter-spacing: -0.05em;
		line-height: 0.92;
	}

	.lead {
		max-width: 42rem;
		margin-bottom: 4rem;
		color: var(--muted-strong);
		font-size: 1.1rem;
		line-height: 1.7;
	}

	section {
		margin-top: 3rem;
		padding-top: 2rem;
		border-top: 1px solid var(--line);
	}

	h2 {
		margin-bottom: 0.8rem;
		font-size: clamp(1.7rem, 3vw, 2.5rem);
		letter-spacing: -0.035em;
	}

	section p {
		max-width: 42rem;
		color: var(--muted-strong);
		line-height: 1.7;
	}

	.legal-footer {
		justify-content: flex-start;
		flex-wrap: wrap;
		border-top: 1px solid var(--line);
		border-bottom: 0;
	}

	@media (max-width: 520px) {
		.legal-header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
