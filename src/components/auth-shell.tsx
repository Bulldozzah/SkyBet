import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SkyBackdrop } from "@/components/sky-backdrop";
import { cn } from "@/lib/utils";

/**
 * Split layout for every unauthenticated screen: a sky-and-clouds panel on the
 * left and the form on the right. The panel is decorative only, so it is
 * dropped below `md` rather than shrunk — on a phone the form gets the whole
 * viewport.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 max-w-2xl md:block">
        <SkyBackdrop className="h-full w-full" />
        <div className="absolute inset-0 flex flex-col justify-end p-10">
          <Link
            to="/"
            className="text-3xl font-black tracking-tight text-slate-900 dark:text-white"
          >
            SKY<span className="text-primary">BET</span>
          </Link>
          <p className="mt-2 max-w-xs text-sm text-slate-700 dark:text-slate-300">
            Cover every outcome. Spread your stake across all of them and know where you stand
            before the whistle.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col items-center justify-center px-5 py-10 md:w-1/2 md:flex-1">
        <div className={cn("w-full", wide ? "max-w-lg" : "max-w-sm")}>
          {/* Wordmark, shown only when the brand panel is hidden. */}
          <Link
            to="/"
            className="mb-8 inline-block text-2xl font-black tracking-tight text-foreground md:hidden"
          >
            SKY<span className="text-primary">BET</span>
          </Link>

          <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}

          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Inline message banner. */
export function Alert({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "mb-4 rounded-xl border px-4 py-3 text-sm",
        tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "info" && "border-border bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Pill-shaped field with a leading icon, matching the reference design.
 * The icon is decorative — the label and placeholder carry the meaning.
 */
export function IconField({
  id,
  icon: Icon,
  label,
  ...input
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex h-12 w-full items-center gap-3 rounded-full border border-input bg-background pl-5 pr-4 transition focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          id={id}
          className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          {...input}
        />
      </div>
    </div>
  );
}

/** Full-width pill button used by the auth forms. */
export function PillButton({
  children,
  variant = "primary",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "h-12 w-full rounded-full text-sm font-semibold transition disabled:opacity-60",
        variant === "primary"
          ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          : "border border-border bg-card text-foreground hover:bg-accent",
      )}
      {...props}
    >
      {children}
    </button>
  );
}
