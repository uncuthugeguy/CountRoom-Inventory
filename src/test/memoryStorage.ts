/**
 * An in-memory Storage for tests, so a suite never depends on the host's
 * localStorage implementation (Node 25 ships its own, which shadows jsdom's).
 */
export function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
  }
}
