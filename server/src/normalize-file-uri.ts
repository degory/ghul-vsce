import { URL } from "url";

export function normalizeFileUri(uri: string): string {
	// We need all URIs that refer to the same file to always be
	// equal to each other, but some sources URL encode the ':'
	// in Windows file names and some don't:
	return new URL(uri).toString().replace('%3A', ':');
}
