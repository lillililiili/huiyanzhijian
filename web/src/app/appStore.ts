import { createStore, type InspectionStore } from "../domain/store";
import { localStoragePersistence } from "../persistence/localStoragePersistence";

let appStore: InspectionStore | null = null;

export function getAppStore() {
  if (!appStore) {
    appStore = createStore({ persistence: localStoragePersistence(window.localStorage) });
  }
  return appStore;
}
