<svelte:head>
	<title>Termos de uso — Fichário Virtual</title>
	<meta
		name="description"
		content="Termos de uso experimental do Fichário Virtual, seus limites e responsabilidades."
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
		<p class="eyebrow">Leia antes de começar</p>
		<h1 id="page-title">Termos de uso</h1>
		<p class="lead">
			O Fichário Virtual é um produto de uso experimental para organizar e pesquisar seus próprios
			documentos. Ao criar uma conta, você concorda com estes termos e com a <a href="/privacy/"
				>política de privacidade</a
			>.
		</p>

		<section aria-labelledby="service-title">
			<h2 id="service-title">O serviço</h2>
			<p>
				O Fichário oferece biblioteca, cadernos, tags, importação de imagens e PDFs, OCR, revisão e
				busca textual, fuzzy e semântica conforme a disponibilidade da conta e dos provedores.
				Recursos podem mudar durante a fase experimental.
			</p>
			<p>
				Contas public têm limites operacionais e usam o caminho Azure para OCR. Contas owner podem
				usar o pipeline Gemini do produto. Nenhum usuário escolhe o provedor por parâmetros enviados
				pelo cliente.
			</p>
		</section>

		<section aria-labelledby="responsibility-title">
			<h2 id="responsibility-title">Sua responsabilidade</h2>
			<p>
				Use o Fichário apenas com documentos que você pode armazenar e processar. Mantenha sua senha
				em segurança, revise os resultados de OCR antes de tratá-los como transcrição fiel e
				mantenha cópias próprias dos arquivos importantes.
			</p>
			<p>
				Ao conectar o Google Drive, você autoriza somente o acesso necessário ao fluxo apresentado.
				A conexão pode ser removida nas configurações e não autoriza o Fichário a apagar seus
				originais.
			</p>
		</section>

		<section aria-labelledby="limits-title">
			<h2 id="limits-title">Limites e disponibilidade</h2>
			<p>
				O uso é experimental, sem cobrança, sem garantia de disponibilidade contínua e sujeito a
				limites de páginas, tamanho, concorrência e taxa para proteger o serviço. O Fichário pode
				pausar uma operação, pedir nova tentativa ou encerrar uma conta que abuse do serviço ou
				viole estes termos.
			</p>
		</section>

		<section aria-labelledby="ending-title">
			<h2 id="ending-title">Encerrar o uso</h2>
			<p>
				Você pode desconectar o Drive, exportar seus dados e solicitar a exclusão da conta nas
				configurações. A exclusão encerra a sessão e remove os dados do Fichário; arquivos que
				continuam no seu Google Drive não são apagados automaticamente.
			</p>
		</section>
	</article>

	<footer class="legal-footer">
		<a href="/privacy/">Privacidade</a>
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
