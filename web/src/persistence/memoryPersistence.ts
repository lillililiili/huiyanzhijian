import type { Persistence } from "./persistence";

export function memoryPersistence(items = new Map<string, string>(), blocked = false): Persistence {
  return {
    read(key) {
      if (blocked) throw new Error("blocked");
      return items.get(key) ?? null;
    },
    write(key, value) {
      if (blocked) throw new Error("blocked");
      items.set(key, value);
    }
  };
}
