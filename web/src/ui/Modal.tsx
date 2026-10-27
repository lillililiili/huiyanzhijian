import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { useDialog } from "./useDialog";

type ModalProps = {
  title: string;
  open: boolean;
  submitLabel?: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (data: FormData, form: HTMLFormElement) => Promise<false | void> | false | void;
};

export function Modal({ title, open, submitLabel = "保存", children, onClose, onSubmit }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useDialog(open, onClose, dialogRef, "form");

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const button = form.querySelector<HTMLButtonElement>("[type=submit]");
    if (button) button.disabled = true;
    setBusy(true);
    try {
      const result = await onSubmit(new FormData(form), form);
      if (result !== false) onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(message || "保存失败，请检查输入");
    } finally {
      setBusy(false);
      if (button?.isConnected) button.disabled = false;
    }
  }

  return createPortal(
    <div className="overlay">
      <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}>
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <form id="active-modal-form" ref={formRef} onSubmit={submit}>
          <div className="modal-content">
            {children}
            <div className="form-error" role="alert">{error}</div>
          </div>
          <div className="modal-footer">
            <Button onClick={onClose}>取消</Button>
            <button className="btn primary" type="submit" disabled={busy}>{submitLabel}</button>
          </div>
        </form>
      </section>
    </div>,
    document.body
  );
}
