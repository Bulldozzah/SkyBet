import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

/**
 * Gates a page by auth state, approval status and (optionally) admin role.
 *
 * Guard order matches betmaster exactly:
 *   1. still loading            -> spinner, decide nothing
 *   2. no signed-in user        -> /login
 *   3. needs admin, isn't admin -> /calculator
 *   4. not approved             -> /pending
 *
 * The redirect runs in an effect rather than during render because this app is
 * server-rendered: on the server there is no session, so rendering a redirect
 * would bounce every visitor to /login before the browser can restore theirs.
 */
export function ProtectedRoute({
  children,
  requireAdmin = false,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
}) {
  const { user, profile, loading, isAdmin, isApproved } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (requireAdmin && !isAdmin) {
      navigate({ to: "/calculator", replace: true });
      return;
    }
    // Profile may briefly be null right after sign-in; only redirect once it
    // has actually loaded and says the user isn't approved.
    if (!requireAdmin && profile && !isApproved) {
      navigate({ to: "/pending", replace: true });
    }
  }, [loading, user, profile, isAdmin, isApproved, requireAdmin, navigate]);

  if (loading || !user) return <RouteSpinner />;
  if (requireAdmin && !isAdmin) return <RouteSpinner />;
  if (!requireAdmin && profile && !isApproved) return <RouteSpinner />;
  // Approved, or profile still loading for an authenticated user.
  if (!requireAdmin && !profile) return <RouteSpinner />;

  return <>{children}</>;
}

export function RouteSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 bg-background text-muted-foreground">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
