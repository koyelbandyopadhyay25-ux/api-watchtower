/**
 * The single source of truth for the deliberately small public test catalog.
 * The browser imports this data for its presets; backend validation remains authoritative.
 */
export const SUPPORTED_ENDPOINTS = [
  { label: 'Todo item', path: '/todos/1', url: 'https://jsonplaceholder.typicode.com/todos/1' },
  { label: 'Post', path: '/posts/1', url: 'https://jsonplaceholder.typicode.com/posts/1' },
  { label: 'User profile', path: '/users/1', url: 'https://jsonplaceholder.typicode.com/users/1' },
  { label: 'Post comments', path: '/posts/1/comments', url: 'https://jsonplaceholder.typicode.com/posts/1/comments' },
] as const;

const STANDARD_PORT_FORMS = SUPPORTED_ENDPOINTS.map(({ url }) =>
  url.replace('https://jsonplaceholder.typicode.com', 'https://jsonplaceholder.typicode.com:443'));

/** Accept only canonical catalog strings, retaining the previously supported explicit :443 form. */
export function canonicalSupportedUrl(value: string): string | null {
  if (value.length > 2048 || value !== value.trim() || /[\\@?#\s]/.test(value)) return null;

  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      (parsed.port !== '' && parsed.port !== '443')) return null;

  const index = SUPPORTED_ENDPOINTS.findIndex(endpoint => endpoint.url === parsed.href);
  if (index < 0 || (value !== SUPPORTED_ENDPOINTS[index]!.url && value !== STANDARD_PORT_FORMS[index])) return null;
  return SUPPORTED_ENDPOINTS[index]!.url;
}
