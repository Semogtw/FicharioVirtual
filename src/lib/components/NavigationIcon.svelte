<script lang="ts">
	export type NavigationIconName =
		'home' | 'library' | 'notebooks' | 'import' | 'coverage' | 'drive' | 'settings' | 'more';

	interface NavigationIconProps {
		name: NavigationIconName;
	}

	let { name }: NavigationIconProps = $props();
</script>

<svg
	class="navigation-icon"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'home'}
		<path d="m3 10.5 9-7.5 9 7.5" />
		<path d="M5.5 9.5V21h13V9.5" />
		<path d="M9.5 21v-6h5v6" />
	{:else if name === 'library'}
		<path d="M4 4.5h5V20H4z" />
		<path d="M10.5 4.5h4V20h-4z" />
		<path d="m16 5 3.3-.9L23 18.8l-3.3.9z" />
	{:else if name === 'notebooks'}
		<path d="M6 3.5h12a2 2 0 0 1 2 2V20H6a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
		<path d="M8 3.5V20" />
		<path d="M11 8h6" />
	{:else if name === 'import'}
		<path d="M12 3v12" />
		<path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
		<path d="M5 14.5V20h14v-5.5" />
	{:else if name === 'coverage'}
		<path d="M5 4h14v16H5z" />
		<path d="m8 9 1.5 1.5L12 8" />
		<path d="M14 9h2" />
		<path d="m8 15 1.5 1.5L12 14" />
		<path d="M14 15h2" />
	{:else if name === 'drive'}
		<path d="M7.2 18.5h10.6a3.7 3.7 0 0 0 .7-7.3A6.8 6.8 0 0 0 5.6 9.6 4.5 4.5 0 0 0 7.2 18.5Z" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"
		/>
	{:else if name === 'more'}
		<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
		<circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
	{/if}
</svg>

<style>
	.navigation-icon {
		display: block;
		width: 1.25rem;
		height: 1.25rem;
		flex: 0 0 auto;
	}
</style>
