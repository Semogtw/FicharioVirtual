import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'.svelte-kit/**',
			'build/**',
			'coverage/**',
			'playwright-report/**',
			'test-results/**'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser
			}
		},
		rules: {
			// Existing routes use absolute internal paths. Adopt resolve() separately with route typing.
			'svelte/no-navigation-without-resolve': 'off',
			// Keying lists and replacing Map/Set can change component state semantics; migrate deliberately.
			'svelte/require-each-key': 'off',
			'svelte/prefer-svelte-reactivity': 'off'
		}
	},
	{
		files: ['src/lib/services/document-organization.ts', 'src/lib/services/tags.ts'],
		rules: {
			// These expressions intentionally reject ASCII control characters from user-visible labels.
			'no-control-regex': 'off'
		}
	},
	prettier
);
