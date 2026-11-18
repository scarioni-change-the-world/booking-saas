/** Only a page inside this business's own admin: "account", or one service. */
export function returnPath(value: unknown): string {
  if (typeof value === 'string' && /^sessions\/[0-9a-f-]{36}\?tab=details$/.test(value)) return value;
  return 'account';
}
