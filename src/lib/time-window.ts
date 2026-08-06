// Kickoff time-of-day filtering, shared by the Scanner (which narrows games
// before combining) and the Test workbench (which narrows the cached scan the
// same way). Times are the viewer's local wall clock — "after 18:00" means the
// user's evening — so these must only run client-side, after mount.

/** Kickoff as a local 'HH:MM', comparable to an <input type="time">. */
export const localTime = (iso: string | Date): string => {
  const d = iso instanceof Date ? iso : new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * True when a kickoff falls inside an optional local time-of-day window.
 * Either end may be blank, so "from 18:00" and "up to 20:00" both work, and
 * clearing both covers the whole day again.
 */
export const inTimeWindow = (iso: string, from: string, to: string): boolean => {
  if (!from && !to) return true;
  const t = localTime(iso);
  return (!from || t >= from) && (!to || t <= to);
};
