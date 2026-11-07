import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const floatingLabel =
  "pointer-events-none absolute left-2.5 top-0 -translate-y-1/2 bg-surface px-1 text-[12px] leading-4 text-text-2 transition-all";

/** Outlined text field with a floating label, like the 2019 Google forms. */
export function TextField({
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <div>
      <label className="relative block">
        <input
          {...input}
          placeholder=" "
          aria-invalid={error ? true : undefined}
          className={`field peer ${error ? "!border-[var(--error)]" : ""}`}
        />
        <span
          className={`${floatingLabel} peer-placeholder-shown:top-1/2 peer-placeholder-shown:text-[16px] peer-focus:top-0 peer-focus:text-[12px] peer-focus:text-[var(--focus)]`}
        >
          {label}
        </span>
      </label>
      <FieldNote hint={hint} error={error} />
    </div>
  );
}

export function SelectField({
  label,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="relative block">
      <select {...select} className="field appearance-none pr-8">
        {children}
      </select>
      <span className={floatingLabel}>{label}</span>
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-2">
        ▾
      </span>
    </label>
  );
}

export function FieldNote({ hint, error }: { hint?: ReactNode; error?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="mt-1.5 px-1 text-[12px] leading-4 text-error">
        {error}
      </p>
    );
  }
  if (hint) return <p className="mt-1.5 px-1 text-[12px] leading-4 text-text-2">{hint}</p>;
  return null;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-sm bg-[#fce8e6] px-3 py-2 text-[14px] text-[#c5221f] dark:bg-[#3c1f1d] dark:text-[#f28b82]">
      {message}
    </p>
  );
}

/** "or" between the Google button and the email form. */
export function OrDivider() {
  return (
    <div className="my-6 flex items-center gap-4 text-[12px] uppercase text-text-2">
      <span className="h-px flex-1 bg-divider" />
      or
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}
