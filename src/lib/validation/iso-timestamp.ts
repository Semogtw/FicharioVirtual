const RFC3339 =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/;

export function isIsoTimestamp(value: string): boolean {
	const match = RFC3339.exec(value);
	if (!match) return false;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
	const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);

	if (
		month < 1 ||
		month > 12 ||
		day < 1 ||
		hour > 23 ||
		minute > 59 ||
		second > 59 ||
		offsetHour > 23 ||
		offsetMinute > 59
	) {
		return false;
	}

	const calendarDate = new Date(0);
	calendarDate.setUTCFullYear(year, month - 1, day);
	calendarDate.setUTCHours(0, 0, 0, 0);
	if (
		calendarDate.getUTCFullYear() !== year ||
		calendarDate.getUTCMonth() !== month - 1 ||
		calendarDate.getUTCDate() !== day
	) {
		return false;
	}

	return Number.isFinite(Date.parse(value));
}
