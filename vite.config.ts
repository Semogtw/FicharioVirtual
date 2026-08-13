import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			strategies: 'generateSW',
			registerType: 'autoUpdate',
			injectRegister: false,
			base: '/',
			scope: '/',
			includeAssets: ['favicon.svg'],
			manifest: {
				name: 'Fichário Virtual',
				short_name: 'Fichário',
				description: 'Biblioteca pessoal pesquisável para anotações, imagens e PDFs.',
				theme_color: '#f7f4ee',
				background_color: '#f7f4ee',
				display: 'standalone',
				start_url: '/',
				scope: '/',
				lang: 'pt-BR',
				icons: [
					{
						src: '/favicon.svg',
						sizes: 'any',
						type: 'image/svg+xml',
						purpose: 'any maskable'
					}
				]
			},
			kit: {
				assets: 'static',
				outDir: '.svelte-kit',
				appDir: '_app',
				includeVersionFile: true,
				adapterFallback: '200.html',
				trailingSlash: 'always'
			},
			workbox: {
				globPatterns: ['client/**/*.{js,css,svg,ico,woff,woff2,webmanifest}'],
				globIgnores: ['**/*.map'],
				additionalManifestEntries: [{ url: '_app/env.js', revision: null }],
				navigateFallback: '/200.html',
				cleanupOutdatedCaches: true,
				skipWaiting: true,
				clientsClaim: true
			}
		})
	],
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			reportsDirectory: 'coverage'
		}
	}
});
