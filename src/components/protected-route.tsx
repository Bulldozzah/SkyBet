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
  const { user, profile, loading, profileError, isAdmin, isApproved, refreshProfile, signOut } =
    useAuth();
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

  if (loading) return <RouteSpinner />;
  // Redirecting to /login.
  if (!user) return <RouteSpinner />;
  // Redirecting to /calculator.
  if (requireAdmin && !isAdmin) return <RouteSpinner />;

  // The profile lookup failed for a recoverable reason. Without this the page
  // would spin forever waiting for a profile that is never going to arrive.
  if (profileError) {
    return (
      <ProfileProblem
        message={profileError}
        onRetry={() => void refreshProfile()}
        onSignOut={() => void signOut()}
      />
    );
  }

  // Signed in, no error, profile still in flight — genuinely transient.
  if (!profile) return <RouteSpinner />;
  // Redirecting to /pending.
  if (!requireAdmin && !isApproved) return <RouteSpinner />;

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

function ProfileProblem({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-sm text-center">
        <h1 className="text-lg font-bold">Couldn&apos;t load your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We signed you in, but your profile didn&apos;t load.
        </p>
        <p className="mt-2 break-words rounded-md bg-secondary px-3 py-2 text-xs text-secondary-foreground">
          {message}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onRetry} className="btn-primary">
            Try again
          </button>
          <button onClick={onSignOut} className="btn-secondary">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
