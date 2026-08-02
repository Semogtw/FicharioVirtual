export class RequestVersion {
	#current = 0;

	next() {
		this.#current += 1;
		return this.#current;
	}

	current() {
		return this.#current;
	}

	isCurrent(version: number) {
		return Number.isInteger(version) && version === this.#current;
	}
}
