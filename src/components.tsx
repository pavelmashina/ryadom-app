import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { X } from "lucide-react";
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      {label}
      <input {...props} />
    </label>
  );
}
export function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="field">
      {label}
      <select {...props}>{children}</select>
    </label>
  );
}
export function Note({
  label = "Заметка",
  value = "",
}: {
  label?: string;
  value?: string;
}) {
  return (
    <label className="field">
      {label}
      <textarea
        name="note"
        defaultValue={value}
        maxLength={5000}
        placeholder="Необязательно"
      />
    </label>
  );
}
export function Form({
  children,
  onSave,
  label = "Сохранить",
}: {
  children: ReactNode;
  onSave: (data: FormData) => void | Promise<void>;
  label?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setError("");
    setBusy(true);
    try {
      await onSave(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {children}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Сохранение…" : label}
      </button>
    </form>
  );
}
export const text = (d: FormData, n: string) => String(d.get(n) || "").trim();
export const number = (d: FormData, n: string) => Number(d.get(n));
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
