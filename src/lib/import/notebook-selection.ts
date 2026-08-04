const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NotebookIdentity = {
	id: string;
};

function assertNotebookId(value: string): void {
	if (!UUID.test(value)) throw new TypeError('Invalid notebook identifier');
}

export function parseRequestedNotebookId(searchParams: URLSearchParams): string | null {
	const values = searchParams.getAll('notebook');
	if (values.length !== 1) return null;
	const [value] = values;
	return value && UUID.test(value) ? value : null;
}

export function resolveRequestedNotebookId(
	requestedNotebookId: string | null,
	notebooks: readonly NotebookIdentity[]
): string {
	return requestedNotebookId !== null &&
		notebooks.some((notebook) => notebook.id === requestedNotebookId)
		? requestedNotebookId
		: '';
}

export function importSelectionUrl(currentUrl: URL, notebookId: string): URL {
	const url = new URL(currentUrl);
	if (notebookId === '') {
		url.searchParams.delete('notebook');
		return url;
	}
	assertNotebookId(notebookId);
	url.searchParams.set('notebook', notebookId);
	return url;
}

export function importHref(path: string, notebookId: string | null): string {
	if (notebookId === null) return path;
	assertNotebookId(notebookId);
	const url = new URL(path, 'https://fichario.local');
	url.searchParams.set('notebook', notebookId);
	return `${url.pathname}${url.search}`;
}
