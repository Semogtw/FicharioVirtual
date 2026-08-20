<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { AuthServiceError } from '$lib/services/auth';
	import { RequestVersion } from '$lib/services/request-version';
	import { authenticate, register, sessionState } from '$lib/stores/session.svelte';

	type AuthMode = 'sign_in' | 'sign_up';

	let mode = $state<AuthMode>('sign_in');
	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let submitting = $state(false);
	let authenticated = $state(false);
	let authenticationError = $state<string | null>(null);
	let navigationError = $state<string | null>(null);
	let notice = $state<string | null>(null);
	const authenticationRequests = new RequestVersion();

	function switchMode(nextMode: AuthMode) {
		if (submitting || authenticated || mode === nextMode) return;
		authenticationRequests.next();
		mode = nextMode;
		authenticationError = null;
		navigationError = null;
		notice = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting || authenticated) return;
		const version = authenticationRequests.next();
		submitting = true;
		authenticationError = null;
		navigationError = null;
		notice = null;
		try {
			try {
				if (mode === 'sign_up') {
					const result = await register(email, password);
					if (!authenticationRequests.isCurrent(version)) return;
					if (result.confirmationRequired) {
						notice = 'Conta criada. Confira seu e-mail para confirmar o acesso.';
						return;
					}
				} else {
					await authenticate(email, password);
					if (!authenticationRequests.isCurrent(version)) return;
				}
				authenticated = true;
			} catch (error) {
				if (!authenticationRequests.isCurrent(version)) return;
				authenticationError =
					error instanceof AuthServiceError
						? error.message
						: (sessionState.error ?? 'Não foi possível confirmar o acesso agora. Tente novamente.');
				return;
			}
			try {
				await goto('/');
			} catch {
				if (!authenticationRequests.isCurrent(version)) return;
				navigationError = 'Acesso confirmado, mas não foi possível abrir o fichário.';
			}
		} finally {
			if (authenticationRequests.isCurrent(version)) submitting = false;
		}
	}

	onDestroy(() => {
		authenticationRequests.next();
	});
</script>

<svelte:head>
	<title>Entrar ou criar conta — Fichário Virtual</title>
</svelte:head>

<main class="login-page" aria-labelledby="login-title">
	<section class="introduction">
		<a class="brand" href="/login/" aria-label="Fichário Virtual">
			<span aria-hidden="true">FV</span>
			<strong>Fichário Virtual</strong>
		</a>
		<div>
			<p class="eyebrow">Seu arquivo digital</p>
			<h1 id="login-title">Acesse seu fichário</h1>
			<p class="summary">
				Organize documentos, encontre conteúdo por texto ou significado e mantenha os originais no
				seu próprio Google Drive.
			</p>
		</div>
		<ul>
			<li>Arquivos privados e isolados por conta</li>
			<li>Busca textual, fuzzy e semântica</li>
			<li>OCR, revisão e organização no mesmo fluxo</li>
		</ul>
	</section>

	<section class="form-panel" aria-label="Acesso ao Fichário Virtual">
		{#if authenticated}
			<div class="authenticated" role="status">
				<h2>Acesso confirmado.</h2>
				{#if navigationError}<p class="error">{navigationError}</p>{/if}
				<a href="/">Abrir o fichário</a>
			</div>
		{:else}
			<div class="mode-switch" aria-label="Escolha entre entrar e criar conta">
				<button
					type="button"
					class:active={mode === 'sign_in'}
					aria-pressed={mode === 'sign_in'}
					onclick={() => switchMode('sign_in')}>Entrar</button
				>
				<button
					type="button"
					class:active={mode === 'sign_up'}
					aria-pressed={mode === 'sign_up'}
					onclick={() => switchMode('sign_up')}>Criar conta</button
				>
			</div>

			<form onsubmit={submit}>
				<div class="field">
					<label for="email">E-mail</label>
					<input id="email" type="email" bind:value={email} autocomplete="email" required />
				</div>

				<div class="field">
					<label for="password">Senha</label>
					<div class="password-input">
						<input
							id="password"
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							autocomplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
							minlength={mode === 'sign_up' ? 8 : undefined}
							required
						/>
						<button
							type="button"
							class="password-toggle"
							aria-pressed={showPassword}
							aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
							onclick={() => (showPassword = !showPassword)}
						>
							{showPassword ? 'Ocultar' : 'Mostrar'}
						</button>
					</div>
				</div>

				{#if authenticationError ?? sessionState.error}
					<p class="error" role="alert">{authenticationError ?? sessionState.error}</p>
				{/if}
				{#if notice}
					<p class="notice" role="status">{notice}</p>
				{/if}

				<Button
					label={submitting
						? mode === 'sign_up'
							? 'Criando conta…'
							: 'Confirmando acesso…'
						: mode === 'sign_up'
							? 'Criar conta'
							: 'Entrar'}
					type="submit"
					disabled={submitting}
				/>
			</form>

			<p class="access-note">
				{mode === 'sign_up'
					? 'A conta pública usa o mesmo Fichário e mantém seus documentos separados dos demais usuários.'
					: 'Ainda não tem uma conta? Escolha “Criar conta” acima.'}
			</p>
		{/if}
	</section>
</main>

<style>
	.login-page {
		min-height: 100vh;
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(22rem, 0.9fr);
		background: var(--paper);
	}

	.introduction {
		display: grid;
		align-content: space-between;
		gap: 3rem;
		padding: clamp(2rem, 7vw, 6rem);
		background:
			linear-gradient(90deg, rgb(83 106 91 / 8%) 1px, transparent 1px) 0 0 / 4rem 4rem,
			var(--paper);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		width: fit-content;
	}

	.brand > span {
		width: 2.75rem;
		height: 2.75rem;
		display: grid;
		place-items: center;
		border-radius: 0.7rem;
		background: var(--archive);
		color: white;
		font-family: var(--font-heading);
		font-size: 0.85rem;
		font-weight: 700;
	}

	.brand strong {
		font-family: var(--font-heading);
		font-size: 1.15rem;
		font-weight: 600;
	}

	.eyebrow {
		margin-bottom: 0.7rem;
		color: var(--archive);
		font-size: 0.76rem;
		font-weight: 780;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		max-width: 42rem;
		margin-bottom: 1rem;
		font-family: var(--font-heading);
		font-size: clamp(3rem, 8vw, 6.75rem);
		font-weight: 520;
		letter-spacing: -0.055em;
		line-height: 0.92;
	}

	.summary {
		max-width: 37rem;
		margin-bottom: 0;
		color: var(--muted);
		font-size: clamp(1rem, 2vw, 1.2rem);
		line-height: 1.65;
	}

	ul {
		display: grid;
		gap: 0.65rem;
		margin: 0;
		padding-left: 1.15rem;
		color: var(--muted);
		line-height: 1.5;
	}

	.form-panel {
		display: grid;
		align-content: center;
		gap: 1.5rem;
		padding: clamp(2rem, 7vw, 6rem);
		border-left: 1px solid var(--line);
		background: var(--surface);
	}

	.mode-switch {
		display: grid;
		grid-template-columns: 1fr 1fr;
		width: min(100%, 28rem);
		padding: 0.25rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--paper);
	}

	.mode-switch button {
		min-height: 2.6rem;
		border: 0;
		border-radius: calc(var(--radius-sm) - 0.2rem);
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-weight: 720;
		cursor: pointer;
	}

	.mode-switch button.active {
		background: var(--surface-strong);
		color: var(--ink);
		box-shadow: 0 1px 3px rgb(37 45 40 / 10%);
	}

	form {
		display: grid;
		gap: 1.15rem;
		width: min(100%, 28rem);
	}

	.field {
		display: grid;
		gap: 0.45rem;
	}

	label {
		font-size: 0.86rem;
		font-weight: 720;
	}

	input {
		width: 100%;
		min-height: 3.2rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-strong);
		color: var(--ink);
	}

	.password-input {
		position: relative;
	}

	.password-input input {
		padding-right: 5.2rem;
	}

	.password-toggle {
		position: absolute;
		top: 50%;
		right: 0.45rem;
		min-height: 2.3rem;
		padding: 0.4rem 0.65rem;
		border: 0;
		border-radius: calc(var(--radius-sm) - 0.15rem);
		background: transparent;
		color: var(--archive);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 740;
		cursor: pointer;
		transform: translateY(-50%);
	}

	.password-toggle:hover {
		background: var(--archive-soft);
	}

	.authenticated {
		display: grid;
		gap: 1rem;
		width: min(100%, 28rem);
		padding: 1rem;
		border-left: 0.3rem solid var(--archive);
		background: var(--archive-soft);
	}

	.authenticated h2,
	.authenticated p {
		margin: 0;
	}

	.authenticated a {
		width: fit-content;
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		padding: 0.65rem 0.9rem;
		border-radius: var(--radius-sm);
		background: var(--archive);
		color: white;
		font-weight: 740;
	}

	.error,
	.notice {
		margin: 0;
		padding: 0.8rem 0.9rem;
		line-height: 1.45;
	}

	.error {
		border-left: 0.25rem solid var(--danger);
		background: rgb(155 63 54 / 8%);
		color: var(--danger);
	}

	.notice {
		border-left: 0.25rem solid var(--archive);
		background: var(--archive-soft);
		color: var(--ink);
	}

	.access-note {
		max-width: 28rem;
		margin: 0;
		color: var(--muted);
		font-size: 0.86rem;
		line-height: 1.55;
	}

	@media (max-width: 820px) {
		.login-page {
			grid-template-columns: 1fr;
		}

		.introduction {
			min-height: 42vh;
		}

		.introduction ul {
			display: none;
		}

		.form-panel {
			border-top: 1px solid var(--line);
			border-left: 0;
		}
	}
</style>
