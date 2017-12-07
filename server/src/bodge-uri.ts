export function bodgeUri(uri: string): string {
	// FIXME: what's the correct decoding to apply? Presumably URL?
	return uri.replace('%3A', ':');
}
