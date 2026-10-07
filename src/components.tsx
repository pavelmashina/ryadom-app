import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { X, LoaderCircle, ChevronRight } from "lucide-react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  loading?: boolean;
  loadingText?: string;
};
export function Button({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  loading = false,
  loadingText = "Сохраняем…",
  disabled,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`btn btn-${variant} btn-${size} ${fullWidth ? "btn-block" : ""} ${className}`}
    >
      {loading && <LoaderCircle className="spinner" aria-hidden="true" />}
      {loading ? loadingText : children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: Omit<ButtonProps, "aria-label" | "fullWidth"> & { label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      {...props}
      aria-label={label}
      title={label}
      className={`icon-button ${className}`}
    >
      {children}
    </Button>
  );
}
export function Card({
  children,
  className = "",
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "info";
}) {
  return (
    <section
      className={`card ${variant === "info" ? "card-info" : ""} ${className}`}
    >
      {children}
    </section>
  );
}
export function InteractiveCard({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      variant="ghost"
      {...props}
      className={`card interactive-card ${className}`}
    >
      <span className="interactive-content">{children}</span>
      <ChevronRight className="card-chevron" aria-hidden="true" />
    </Button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function PageHeader({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="heading">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}
export function SectionHeader({
  title,
  children,
  compact = false,
}: {
  title: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`section-title ${compact ? "compact" : ""}`}>
      <h2>{title}</h2>
      {children}
    </div>
  );
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
type FieldMeta = { label: string; error?: string; hint?: string };
export function Input({
  label,
  error,
  hint,
  id: provided,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldMeta) {
  const generated = useId(),
    id = provided || generated;
  const [nativeError, setNativeError] = useState("");
  const issue = error || nativeError;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        aria-invalid={!!issue || undefined}
        aria-describedby={issue || hint ? id + "-help" : undefined}
        onInvalid={(e) => {
          setNativeError(e.currentTarget.validationMessage);
          props.onInvalid?.(e);
        }}
        onInput={(e) => {
          setNativeError("");
          props.onInput?.(e);
        }}
      />
      {(issue || hint) && (
        <span
          id={id + "-help"}
          className={issue ? "field-error" : "hint"}
          role={issue ? "alert" : undefined}
        >
          {issue || hint}
        </span>
      )}
    </div>
  );
}
export const Field = Input;
export function Select({
  label,
  error,
  hint,
  id: provided,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldMeta) {
  const generated = useId(),
    id = provided || generated;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        {...props}
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? id + "-help" : undefined}
      >
        {children}
      </select>
      {(error || hint) && (
        <span
          id={id + "-help"}
          className={error ? "field-error" : "hint"}
          role={error ? "alert" : undefined}
        >
          {error || hint}
        </span>
      )}
    </div>
  );
}
export function Textarea({
  label,
  error,
  hint,
  id: provided,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldMeta) {
  const generated = useId(),
    id = provided || generated;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        {...props}
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? id + "-help" : undefined}
      />
      {(error || hint) && (
        <span
          id={id + "-help"}
          className={error ? "field-error" : "hint"}
          role={error ? "alert" : undefined}
        >
          {error || hint}
        </span>
      )}
    </div>
  );
}
export function Checkbox({
  label,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
}) {
  return (
    <label className={`checkbox ${className}`}>
      <span className="checkbox-hit">
        <input {...props} type="checkbox" />
      </span>
      {label && <span>{label}</span>}
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
    <Textarea
      label={label}
      name="note"
      defaultValue={value}
      maxLength={5000}
      placeholder="Необязательно"
    />
  );
}
export function Form({
  children,
  onSave,
  label = "Сохранить",
  variant = "primary",
}: {
  children: ReactNode;
  onSave: (data: FormData) => void | Promise<void>;
  label?: string;
  variant?: ButtonProps["variant"];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    const d = new FormData(e.currentTarget);
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset className="form-fields" disabled={busy}>
        {children}
      </fieldset>
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant={variant} fullWidth loading={busy}>
          {label}
        </Button>
      </div>
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
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  function close() {
    if (!ref.current?.querySelector('form[aria-busy="true"]')) onClose();
  }
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const b = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Закрыть" onClick={close}>
          <X />
        </IconButton>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
