/**
 * The two currencies the firm quotes in.
 *
 * Cedis for everything by default, because that is where the firm is and what most of
 * its clients are billed in. Dollars because the firm's own pricing proposal quotes the
 * packages in dollars, and a multinational client is not going to be invoiced in cedis.
 *
 * ## Nothing here converts
 *
 * There is no exchange rate in this module and there must not be one anywhere else. A
 * rate would have to come from somewhere, be right on the day, and still be right when
 * somebody reads the invoice six months later - and the moment a figure is converted,
 * the portal is quoting a number the firm never agreed to.
 *
 * So an amount is always in the currency it was entered in, and it is carried with the
 * amount rather than assumed: a package has a currency, a subscription has one, an
 * additional service has one, an invoice has one. A total is only ever the sum of
 * amounts in the same currency, and where two currencies meet - a client on a package
 * priced in dollars, being invoiced in cedis - somebody has to decide, not the portal.
 */

export const CURRENCIES = ["GHS", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** What a new anything is priced in unless somebody says otherwise. */
export const DEFAULT_CURRENCY: Currency = "GHS";

export const CURRENCY_LABELS: Record<Currency, string> = {
  GHS: "Cedis (GHS)",
  USD: "Dollars (USD)",
};

/** How an amount is prefixed. Spelt out rather than symbols, which collide. */
export const CURRENCY_PREFIX: Record<Currency, string> = {
  GHS: "GHS",
  USD: "USD",
};

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** Falls back to cedis rather than throwing: an old row with no currency is in cedis. */
export function currencyOf(value: unknown): Currency {
  return isCurrency(value) ? value : DEFAULT_CURRENCY;
}

/**
 * An amount with its currency in front of it, to the pesewa or the cent.
 *
 * Always with the currency, never bare. "4,500" on a screen that can show both is a
 * figure somebody will read as whichever one they were expecting.
 */
export function formatAmount(
  amount: number,
  currency: unknown,
  options: { decimals?: boolean } = {},
): string {
  const digits = options.decimals === false ? 0 : 2;
  return `${CURRENCY_PREFIX[currencyOf(currency)]} ${amount.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * Whether a set of amounts can honestly be added up.
 *
 * Used wherever a total is shown over rows that each carry their own currency - a
 * statement, a proposal, a list of outstanding invoices. Two currencies means two
 * totals, not one converted one.
 */
export function singleCurrency(rows: Array<{ currency?: unknown }>): Currency | null {
  const found = new Set(rows.map((row) => currencyOf(row.currency)));
  return found.size === 1 ? ([...found][0] as Currency) : null;
}
