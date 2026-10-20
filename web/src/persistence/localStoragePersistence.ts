import type { Persistence } from "./persistence";

export function localStoragePersistence(storage: Pick<Storage, "getItem" | "setItem">): Persistence {
  return {
    read(key) {
      return storage.getItem(key);
    },
    write(key, value) {
      storage.setItem(key, value);
    }
  };
}
