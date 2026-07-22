import { cn } from "@/lib/utils";

/**
 * Decorative sky-and-clouds panel for the auth screens.
 *
 * Drawn as inline SVG rather than loading a stock photo: it needs no network
 * request (the reference markup pointed at a GitHub-hosted image that would
 * break the page if it ever moved), it stays crisp at any size, it themes for
 * dark mode, and — since this app is server-rendered — it emits identical
 * markup on the server and the client.
 *
 * Purely presentational: aria-hidden, and never the only place information
 * appears.
 */
export function SkyBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden bg-gradient-to-b from-sky-300 via-sky-200 to-white",
        "dark:from-slate-900 dark:via-slate-800 dark:to-slate-900",
        className,
      )}
    >
      {/* Sun glow, top-left */}
      <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/60 blur-3xl dark:bg-sky-400/10" />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 700"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="cloudFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.72" />
          </linearGradient>
          {/* One cloud, reused at different sizes and opacities. */}
          <g id="cloud">
            <ellipse cx="60" cy="34" rx="60" ry="18" />
            <circle cx="30" cy="28" r="17" />
            <circle cx="56" cy="20" r="23" />
            <circle cx="86" cy="28" r="16" />
          </g>
        </defs>

        <g fill="url(#cloudFill)" className="dark:opacity-25">
          <use href="#cloud" x="30" y="70" transform="scale(1.25)" opacity="0.95" />
          <use href="#cloud" x="210" y="150" transform="scale(0.8)" opacity="0.7" />
          <use href="#cloud" x="-10" y="330" transform="scale(1.05)" opacity="0.85" />
          <use href="#cloud" x="250" y="470" transform="scale(0.7)" opacity="0.6" />
          <use href="#cloud" x="40" y="620" transform="scale(1.4)" opacity="0.9" />
          <use href="#cloud" x="300" y="760" transform="scale(0.6)" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
}
