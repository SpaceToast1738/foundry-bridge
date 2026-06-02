export function filterWorldData(
  worldData: Record<string, unknown>,
  excludeCollections: readonly string[],
): Record<string, unknown> {
  const excluded = new Set<string>(excludeCollections);
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(worldData)) {
    if (!excluded.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}
