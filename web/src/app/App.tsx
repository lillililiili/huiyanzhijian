import type { InspectionStore } from "../domain/store";
import { ToastViewport } from "../ui/Toast";
import { getAppStore } from "./appStore";
import { AppShell } from "./shell/AppShell";
import { LoginPage } from "./shell/LoginPage";
import { useAppState } from "./useAppState";

export function App({ store }: { store?: InspectionStore }) {
  const active = store ?? getAppStore();
  const model = useAppState(active);
  if (!model.session) {
    return (
      <>
        <LoginPage store={active} users={model.state.users} />
        <ToastViewport />
      </>
    );
  }
  if (model.parsed.route === "login") return <ToastViewport />;
  return (
    <>
      <AppShell store={active} session={model.session} state={model.state} parsed={model.parsed} />
      <ToastViewport />
    </>
  );
}
