import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Calculator,
  Radar,
  Wallet,
  BarChart3,
  Home,
  Menu,
  X,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Home", icon: Home },
  { to: "/calculator", label: "Calculator", icon: Calculator },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/my-bets", label: "My Bets", icon: Wallet },
  { to: "/stats", label: "Stats", icon: BarChart3 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const sidebarWidth = collapsed ? "md:w-16" : "md:w-60";
  const mainPad = collapsed ? "md:pl-16" : "md:pl-60";

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur md:hidden">
        <Link to="/" className="flex items-center gap-2 font-bold text-primary">
          <TrendingUp className="h-5 w-5" />
          BetMaster
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md p-2 text-foreground hover:bg-accent"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Sidebar - desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
          sidebarWidth
        )}
      >
        <div
          className={cn(
            "relative flex items-center px-4 py-5 text-lg font-bold text-primary",
            collapsed ? "justify-center px-2" : "gap-2"
          )}
        >
          <TrendingUp className="h-6 w-6 shrink-0" />
          {!collapsed && <span>BetMaster</span>}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-3 top-6 grid h-6 w-6 place-items-center rounded-full border border-sidebar-border bg-card text-foreground shadow-sm hover:bg-accent"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <nav className={cn("flex-1 space-y-1", collapsed ? "px-2" : "px-3")}>
          {nav.map((item) => {
            const Icon = item.icon;
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition",
                  collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-4")}>
          <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              JD
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">John Doe</div>
                <div className="text-xs text-muted-foreground">Approved</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        >
          <aside
            className="absolute left-0 top-0 h-full w-64 bg-sidebar p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center gap-2 font-bold text-primary">
              <TrendingUp className="h-5 w-5" /> BetMaster
            </div>
            <nav className="space-y-1">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      <main className={cn("transition-[padding] duration-200", mainPad)}>
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
