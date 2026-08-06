// Date formatting that is safe to call during render in a server-rendered app.
//
// `toLocaleString()` with no arguments resolves against the *runtime's* locale
// and timezone. The server (Node, typically en-US/UTC) and the browser rarely
// agree, so the SSR HTML and the first client render disagree and React throws
// a hydration mismatch. Pinning both locale and timeZone makes the output
// identical everywhere.
//
// The trade-off is that times are shown in UTC rather than the viewer's local
// zone. For anything where local time genuinely matters, format it inside an
// effect (client-only) instead of during render.

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTS,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

/** "20 Jul 2026" — identical on server and client. */
export const formatDate = (value: string | number | Date): string =>
  new Date(value).toLocaleDateString("en-GB", DATE_OPTS);

/** "20 Jul 2026, 18:30" — identical on server and client. */
export const formatDateTime = (value: string | number | Date): string =>
  new Date(value).toLocaleString("en-GB", TIME_OPTS);

/**
 * "20 Jul 2026, 18:30" in the viewer's local timezone. Only safe for content
 * that never renders on the server (e.g. rows that appear after a client-side
 * cache read) — anywhere else it reintroduces the hydration mismatch this
 * file exists to avoid. Use it where the shown time must agree with a local
 * wall-clock comparison, like the kickoff time-of-day filter.
 */
export const formatDateTimeLocal = (value: string | number | Date): string =>
  new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
