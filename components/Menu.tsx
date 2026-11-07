"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A small popup menu in the 2019 style: white card, soft shadow,
 * 40 px rows. Closes on outside click and Escape.
 */
export function Menu({
  button,
  label,
  children,
  width = 300,
  onOpen,
  buttonClassName = "grid h-10 min-w-10 place-items-center rounded-full text-icon hover:bg-hover",
}: {
  button: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  width?: number;
  /** Called each time the menu opens. */
  onOpen?: () => void;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          role="menu"
          style={{ width, boxShadow: "var(--menu-shadow)" }}
          className="absolute right-0 top-11 z-50 max-w-[calc(100vw-16px)] rounded-sm bg-surface py-2"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  href,
  trailing,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  const className = `flex h-10 w-full items-center gap-4 px-4 text-left text-[14px] text-text ${
    disabled ? "opacity-50" : "hover:bg-hover"
  }`;
  const inner = (
    <>
      <span className="grid h-6 w-6 shrink-0 place-items-center text-icon">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </>
  );
  if (href && !disabled) {
    return (
      <a role="menuitem" href={href} onClick={onClick} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" onClick={onClick} disabled={disabled} className={className}>
      {inner}
    </button>
  );
}

export function MenuDivider() {
  return <hr className="my-2 border-divider" />;
}
