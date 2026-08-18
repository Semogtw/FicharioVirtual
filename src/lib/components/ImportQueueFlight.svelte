<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { importQueue } from '$lib/stores/import-queue.svelte';
	import { pdfImportQueue } from '$lib/stores/pdf-import-queue.svelte';

	type ImportOrigin = {
		x: number;
		y: number;
		at: number;
	};

	type QueueFlight = {
		id: string;
		startX: number;
		startY: number;
		deltaX: number;
		deltaY: number;
		count: number;
	};

	const ORIGIN_TTL_MS = 2_500;
	const FLIGHT_DURATION_MS = 720;
	const ARRIVAL_DURATION_MS = 560;

	let flights = $state<QueueFlight[]>([]);
	let mounted = $state(false);
	let observedCount = 0;
	let origin: ImportOrigin | null = null;
	let flightSequence = 0;
	const cleanupTimers = new Set<ReturnType<typeof setTimeout>>();

	function isImportRoute() {
		return page.url.pathname === '/import' || page.url.pathname.startsWith('/import/');
	}

	function center(element: Element) {
		const rect = element.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2
		};
	}

	function rememberOrigin(element: Element | null) {
		if (!element) return;
		const point = center(element);
		origin = { ...point, at: performance.now() };
	}

	function captureFileSelection(event: Event) {
		if (!isImportRoute()) return;
		const target = event.target;
		if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
		rememberOrigin(target.closest('label') ?? target);
	}

	function captureDrop(event: DragEvent) {
		if (!isImportRoute()) return;
		const target = event.target;
		rememberOrigin(target instanceof Element ? (target.closest('.drop-zone') ?? target) : null);
	}

	function captureQueueAction(event: MouseEvent) {
		if (!isImportRoute()) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		const queueAction = target.closest('.save-button');
		if (queueAction) rememberOrigin(queueAction);
	}

	function queueTarget() {
		return document.querySelector<HTMLElement>('.queue-trigger');
	}

	function pulseTarget(target: HTMLElement) {
		target.classList.remove('queue-arrival');
		requestAnimationFrame(() => target.classList.add('queue-arrival'));
		const timer = setTimeout(() => {
			target.classList.remove('queue-arrival');
			cleanupTimers.delete(timer);
		}, ARRIVAL_DURATION_MS);
		cleanupTimers.add(timer);
	}

	function launchFlight(count: number) {
		if (!origin || performance.now() - origin.at > ORIGIN_TTL_MS) return;
		const target = queueTarget();
		if (!target) return;

		const destination = center(target);
		const id = `queue-flight-${++flightSequence}`;
		flights = [
			...flights,
			{
				id,
				startX: origin.x,
				startY: origin.y,
				deltaX: destination.x - origin.x,
				deltaY: destination.y - origin.y,
				count
			}
		];
		pulseTarget(target);

		const timer = setTimeout(() => {
			flights = flights.filter((flight) => flight.id !== id);
			cleanupTimers.delete(timer);
		}, FLIGHT_DURATION_MS + 80);
		cleanupTimers.add(timer);
	}

	onMount(() => {
		observedCount = importQueue.items.length + pdfImportQueue.items.length;
		mounted = true;
		document.addEventListener('change', captureFileSelection, true);
		document.addEventListener('drop', captureDrop, true);
		document.addEventListener('click', captureQueueAction, true);

		return () => {
			mounted = false;
			document.removeEventListener('change', captureFileSelection, true);
			document.removeEventListener('drop', captureDrop, true);
			document.removeEventListener('click', captureQueueAction, true);
			for (const timer of cleanupTimers) clearTimeout(timer);
			cleanupTimers.clear();
			queueTarget()?.classList.remove('queue-arrival');
		};
	});

	$effect(() => {
		const total = importQueue.items.length + pdfImportQueue.items.length;
		if (!mounted) {
			observedCount = total;
			return;
		}
		const added = total - observedCount;
		observedCount = total;
		if (added > 0 && isImportRoute()) launchFlight(added);
	});
</script>

{#each flights as flight (flight.id)}
	<div
		class="queue-flight"
		class:batch={flight.count > 1}
		style={`left:${flight.startX}px;top:${flight.startY}px;--flight-x:${flight.deltaX}px;--flight-y:${flight.deltaY}px;`}
		aria-hidden="true"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M7 3.75h6.4L17.25 7.6V20.25H7z" />
			<path d="M13 3.75V8h4.25" />
		</svg>
		{#if flight.count > 1}<strong>{flight.count}</strong>{/if}
	</div>
{/each}

<style>
	.queue-flight {
		position: fixed;
		z-index: 80;
		width: 2.35rem;
		height: 2.35rem;
		display: grid;
		place-items: center;
		pointer-events: none;
		border: 1px solid rgb(var(--archive-rgb) / 28%);
		border-radius: 999px;
		background: var(--archive);
		color: white;
		box-shadow: 0 0.65rem 1.6rem rgb(var(--ink-rgb) / 24%);
		transform: translate(-50%, -50%);
		animation: queue-flight var(--flight-duration, 720ms) var(--ease-emphasized) forwards;
	}

	.queue-flight svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.queue-flight strong {
		position: absolute;
		top: -0.4rem;
		right: -0.45rem;
		min-width: 1.25rem;
		height: 1.25rem;
		display: grid;
		place-items: center;
		padding-inline: 0.25rem;
		border: 2px solid var(--paper);
		border-radius: 999px;
		background: var(--ink);
		color: var(--paper);
		font-size: 0.65rem;
		line-height: 1;
	}

	@keyframes queue-flight {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.62);
		}
		12% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.06);
		}
		72% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(calc(-50% + var(--flight-x)), calc(-50% + var(--flight-y))) scale(0.52);
		}
	}

	@keyframes queue-arrival-pop {
		0%,
		100% {
			transform: scale(1);
		}
		42% {
			transform: scale(1.08);
		}
	}

	@keyframes queue-panel-enter {
		from {
			opacity: 0;
			transform: translateY(-0.35rem) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes import-feedback-enter {
		from {
			opacity: 0;
			transform: translateY(-0.25rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	:global(.queue-trigger.queue-arrival) {
		border-color: var(--archive);
		background: var(--archive-soft);
		color: var(--archive);
		animation: queue-arrival-pop 560ms var(--ease-emphasized);
	}

	:global(.queue-panel) {
		transform-origin: top right;
		animation: queue-panel-enter var(--motion-base) var(--ease-emphasized);
	}

	:global(main .drop-zone) {
		transition:
			border-color var(--motion-fast) var(--ease-standard),
			background-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-base) var(--ease-standard),
			transform var(--motion-fast) var(--ease-emphasized);
	}

	:global(main .drop-icon) {
		transition:
			transform var(--motion-base) var(--ease-emphasized),
			background-color var(--motion-fast) var(--ease-standard);
	}

	:global(main .drop-zone.dragging) {
		box-shadow: 0 0.75rem 2rem rgb(var(--ink-rgb) / 9%);
		transform: translateY(-2px);
	}

	:global(main .drop-zone.dragging .drop-icon) {
		transform: translateY(-2px) scale(1.1) rotate(6deg);
	}

	:global(main .file-button),
	:global(main .camera-button),
	:global(main .save-button),
	:global(main .text-button),
	:global(main .photo-card-actions button) {
		transition:
			background-color var(--motion-fast) var(--ease-standard),
			border-color var(--motion-fast) var(--ease-standard),
			box-shadow var(--motion-base) var(--ease-standard),
			transform var(--motion-fast) var(--ease-emphasized);
	}

	:global(main .photo-card-actions button:first-child),
	:global(main .photo-card-actions button:nth-child(2)) {
		min-width: 2.35rem;
		border-radius: 999px;
		font-size: 1.05rem;
	}

	:global(main .selection-message),
	:global(main .selection-error) {
		animation: import-feedback-enter var(--motion-base) var(--ease-emphasized);
	}

	@media (hover: hover) and (pointer: fine) {
		:global(main .file-button:hover),
		:global(main .camera-button:hover),
		:global(main .text-button:hover),
		:global(main .photo-card-actions button:hover:not(:disabled)) {
			border-color: var(--archive);
			background: var(--archive-soft);
			box-shadow: 0 0.35rem 0.9rem rgb(var(--ink-rgb) / 8%);
			transform: translateY(-1px);
		}

		:global(main .save-button:hover:not(:disabled)) {
			box-shadow: 0 0.45rem 1rem rgb(var(--archive-rgb) / 24%);
			transform: translateY(-1px);
		}
	}

	:global(main .file-button:active),
	:global(main .camera-button:active),
	:global(main .save-button:active:not(:disabled)),
	:global(main .text-button:active),
	:global(main .photo-card-actions button:active:not(:disabled)) {
		box-shadow: none;
		transform: translateY(1px) scale(0.97);
	}
</style>
