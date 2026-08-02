import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { handleUnseenClientRoutes } from './tools/config/prerender-policy.mjs';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '200.html',
			precompress: false,
			strict: true
		}),
		prerender: {
			handleUnseenRoutes: handleUnseenClientRoutes
		}
	}
};

export default config;
