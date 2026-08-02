const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function localDate(value: string, endOfDay: boolean): Date | null {
	const match = DATE_ONLY.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = endOfDay
		? new Date(year, month, day, 23, 59, 59, 999)
		: new Date(year, month, day, 0, 0, 0, 0);

	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month ||
		date.getDate() !== day
	) {
		return null;
	}
	return date;
}

export function localDateStartIso(value: string): string | null {
	return localDate(value, false)?.toISOString() ?? null;
}

export function localDateEndIso(value: string): string | null {
	return localDate(value, true)?.toISOString() ?? null;
}
