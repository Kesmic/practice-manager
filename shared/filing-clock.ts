/**
 * The clock on the wall of the sign-in page.
 *
 * Two dates run every accountant's month in Ghana: PAYE and withholding tax are due
 * with the GRA by the 15th, and the VAT, NHIL and GETFund return by the last working
 * day. The sign-in page counts down to both, live, because a firm whose whole rhythm
 * is those two dates should look like one before anybody has typed a password.
 *
 * Three things this is, and one it is not.
 *
 * **It is Accra time.** Ghana keeps GMT all year and has no daylight saving, so UTC
 * arithmetic is Accra arithmetic, whatever zone the browser is in. A partner opening
 * the portal from London in July sees the deadline the firm is working to, not one an
 * hour out.
 *
 * **It is the statutory rhythm, not a promise.** A last working day that falls on a
 * public holiday moves earlier, and this does not know the holidays. The portal's own
 * filing calendar (worker/dates.ts, and the due-date rules on each engagement) is the
 * record of what is actually due for whom. This is the face on the wall, and it says so
 * in its own copy.
 *
 * **It is shared**, so that a test can pin the arithmetic that the browser draws. Month
 * ends are exactly where naive date code breaks, and a countdown that skipped a month
 * would be worse than none.
 *
 * It is not a source of anything the Worker acts on. Nothing here is ever stored.
 */

const DAY_MS = 86_400_000;

/** One of the two dates, and what to call it. */
export interface Filing {
  key: "paye" | "vat";
  /** The full name, as the page prints it. */
  name: string;
  /** The short name, where there is room for four letters. */
  short: string;
  /** The last second of the deadline day, in UTC. */
  at: Date;
}

/** The 15th of this month if it is still ahead, else the 15th of next month. */
export function nextPayeDeadline(now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = new Date(Date.UTC(y, m, 15, 23, 59, 59));
  return thisMonth.getTime() >= now.getTime()
    ? thisMonth
    : new Date(Date.UTC(y, m + 1, 15, 23, 59, 59));
}

/**
 * The last weekday of the month.
 *
 * Walks back from the month's last day until it lands on Monday to Friday. Date.UTC
 * with day 0 of the following month is the last day of this one, which is the whole
 * reason this does not need to know how long any month is.
 */
export function lastWorkingDay(year: number, month: number): Date {
  let d = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d = new Date(d.getTime() - DAY_MS);
  }
  return d;
}

/** This month's last working day if it is still ahead, else next month's. */
export function nextVatDeadline(now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = lastWorkingDay(y, m);
  return thisMonth.getTime() >= now.getTime() ? thisMonth : lastWorkingDay(y, m + 1);
}

/** Both deadlines, and whichever comes first. */
export function nextFilings(now: Date): { paye: Filing; vat: Filing; soonest: Filing } {
  const paye: Filing = {
    key: "paye",
    name: "PAYE and withholding tax",
    short: "PAYE",
    at: nextPayeDeadline(now),
  };
  const vat: Filing = {
    key: "vat",
    name: "VAT, NHIL and GETFund",
    short: "VAT",
    at: nextVatDeadline(now),
  };
  return { paye, vat, soonest: paye.at.getTime() <= vat.at.getTime() ? paye : vat };
}

/** What is left until a moment, never negative. */
export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** "12d 04:07:33", with the numbers padded so the figure does not jitter as it counts. */
  text: string;
}

export function timeLeft(to: Date, now: Date): TimeLeft {
  let s = Math.max(0, Math.floor((to.getTime() - now.getTime()) / 1000));
  const days = Math.floor(s / 86_400);
  s -= days * 86_400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  const seconds = s - minutes * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    days,
    hours,
    minutes,
    seconds,
    text: `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
}

/** Whole days until a moment, rounded up: a deadline later today is "1 day". */
export function daysLeft(to: Date, now: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - now.getTime()) / DAY_MS));
}

/** "Thu 15 October", the way the firm writes a date in conversation. */
export function filingDate(at: Date): string {
  return at.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** The hour in Accra, 0 to 23. */
export function accraHour(now: Date): number {
  return now.getUTCHours();
}

/** "14:32", Accra. */
export function accraClock(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
}

/**
 * How the page says hello.
 *
 * By the hour in Accra, which is where the firm is, rather than the browser's hour.
 * Somebody signing in from abroad is greeted by the office they are signing in to.
 */
export function greetingFor(hour: number): string {
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  if (hour < 21) return "Good evening.";
  return "Good night.";
}
