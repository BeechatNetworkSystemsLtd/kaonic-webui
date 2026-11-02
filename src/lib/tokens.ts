/** Current values of design tokens (CSS custom properties) as seen from `element`, for drawing outside CSS. `names` maps each key to a token. */
export function readTokens<K extends string>(element: Element, names: Record<K, string>): Record<K, string> {
  const computed = getComputedStyle(element);
  return Object.fromEntries(Object.entries<string>(names).map(([key, name]) => [key, computed.getPropertyValue(name).trim()])) as Record<K, string>;
}
