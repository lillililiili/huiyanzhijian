import { useEffect, useMemo, useRef } from "react";
import { useSyncExternalStore } from "react";
import { getSession, subscribeSession } from "../auth/session";
import type { InspectionStore } from "../domain/store";
import { consumePendingLoginRoute, currentHash, documentTitle, navigate, parseHash, rememberReturnRoute, subscribeHash } from "./hashRoute";

export function useAppState(store: InspectionStore) {
  const hash = useSyncExternalStore(subscribeHash, currentHash, () => "#login");
  const parsed = useMemo(() => parseHash(hash), [hash]);
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const consumedLogin = useRef(false);

  useEffect(() => {
    store.setSession(session);
  }, [store, session]);

  useEffect(() => {
    if (!session && parsed.route !== "login") {
      rememberReturnRoute(parsed.raw);
      navigate("login");
      return;
    }
    if (session && parsed.route === "login") {
      if (consumedLogin.current) return;
      consumedLogin.current = true;
      navigate(consumePendingLoginRoute());
      return;
    }
    consumedLogin.current = false;
  }, [session, parsed.route, parsed.raw]);

  useEffect(() => {
    document.title = documentTitle(parsed.route);
  }, [parsed.route]);

  return { parsed, session, state, store };
}
