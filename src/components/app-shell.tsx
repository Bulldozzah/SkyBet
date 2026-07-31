import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
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
  LogOut,
  ShieldCheck,
  Beaker,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const nav = [
  { to: "/", label: "Home", icon: Home },
  { to: "/calculator", label: "Calculator", icon: Calculator },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/my-bets", label: "My Bets", icon: Wallet },
  { to: "/stats", label: "Stats", icon: BarChart3 },
  { to: "/test", label: "Test", icon: Beaker },
  { to: "/poly", label: "Poly", icon: Coins },
  // Only rendered for administrators — see `visibleNav` below.
  { to: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
];

/** Up to two initials from the display name, e.g. "Abel Chilungu" -> "AC". */
const initialsOf = (source: string) =>
  source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("") || "?";

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, profile, isAdmin, isApproved, signOut } = useAuth();
  const navigate = useNavigate();

  const displayName = profile?.full_name || user?.email || "Guest";
  const roleLabel = !user
    ? "Signed out"
    : isAdmin
      ? "Administrator"
      : isApproved
        ? "Member"
        : "Pending";

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    void navigate({ to: "/login", replace: true });
  };

  // Hiding the link is presentation only — /admin is guarded server-side of the
  // UI by ProtectedRoute and by row-level security on the profiles table.
  const visibleNav = nav.filter((item) => !item.adminOnly || isAdmin);

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
          sidebarWidth,
        )}
      >
        <div
          className={cn(
            "relative flex items-center px-4 py-5 text-lg font-bold text-primary",
            collapsed ? "justify-center px-2" : "gap-2",
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
          {visibleNav.map((item) => {
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
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-4")}>
          <div
            className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}
            title={displayName}
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {initialsOf(displayName)}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{displayName}</div>
                <div className="text-xs text-muted-foreground">{roleLabel}</div>
              </div>
            )}
          </div>

          {user ? (
            <button
              onClick={() => void handleSignOut()}
              title={collapsed ? "Sign out" : undefined}
              className={cn(
                "mt-3 flex w-full items-center rounded-lg text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent",
                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Sign out</span>}
            </button>
          ) : (
            <Link
              to="/login"
              title={collapsed ? "Log in" : undefined}
              className={cn(
                "mt-3 flex w-full items-center rounded-lg text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent",
                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
              )}
            >
              <LogOut className="h-4 w-4 shrink-0 rotate-180" />
              {!collapsed && <span>Log in</span>}
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <aside
            className="absolute left-0 top-0 h-full w-64 bg-sidebar p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center gap-2 font-bold text-primary">
              <TrendingUp className="h-5 w-5" /> BetMaster
            </div>
            <nav className="space-y-1">
              {visibleNav.map((item) => {
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
                        : "text-sidebar-foreground hover:bg-sidebar-accent",
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
