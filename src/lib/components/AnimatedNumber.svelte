<script lang="ts">
	import { onDestroy } from 'svelte';

	interface AnimatedNumberProps {
		value: number | null;
		locale?: string;
		duration?: number;
	}

	let { value, locale = 'pt-BR', duration = 520 }: AnimatedNumberProps = $props();
	let displayedValue = $state<number | null>(value);
	let frame: number | null = null;

	let formattedValue = $derived(
		displayedValue === null ? '—' : Math.round(displayedValue).toLocaleString(locale)
	);
	let accessibleValue = $derived(value === null ? 'Indisponível' : value.toLocaleString(locale));

	function stopAnimation() {
		if (frame === null || typeof cancelAnimationFrame === 'undefined') return;
		cancelAnimationFrame(frame);
		frame = null;
	}

	$effect(() => {
		const target = value;
		if (typeof window === 'undefined') {
			displayedValue = target;
			return;
		}

		stopAnimation();
		if (target === null) {
			displayedValue = null;
			return;
		}

		const start = displayedValue ?? 0;
		if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			displayedValue = target;
			return;
		}

		const startedAt = performance.now();
		const delta = target - start;
		const tick = (now: number) => {
			const progress = Math.min(1, (now - startedAt) / duration);
			const eased = 1 - Math.pow(1 - progress, 3);
			displayedValue = Math.round(start + delta * eased);
			if (progress < 1) frame = requestAnimationFrame(tick);
			else frame = null;
		};
		frame = requestAnimationFrame(tick);

		return stopAnimation;
	});

	onDestroy(stopAnimation);
</script>

<span class="animated-number" aria-label={accessibleValue}>
	<span aria-hidden="true">{formattedValue}</span>
</span>

<style>
	.animated-number {
		display: inline-block;
		min-width: 1ch;
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum';
	}
</style>
