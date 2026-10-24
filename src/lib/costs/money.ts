import {
  type CostCurrency,
  FX_RATE_INTEGER_DIGITS,
  FX_RATE_SCALE,
  MAX_AMOUNT_MINOR,
} from "./constants";

/**
 * Money for costs (COST-3). Amounts are integers in minor units (paise / cents), stored in
 * `bigint` columns and handled as safe JavaScript integers (`MAX_AMOUNT_MINOR`); never a
 * float. Input text is parsed digit by digit, FX conversion is integer arithmetic on
 * BigInt, and display goes through `Intl.NumberFormat` with a decimal STRING, so no value
 * ever passes through binary floating point.
 *
 * Rounding: FX conversion and the yearly run-rate (amount / 12) round HALF-UP (ties away
 * from zero; amounts are never negative, so also "half towards +∞").
 */

/** Both currencies have 2 minor digits (ISO 4217). */
const MINOR_DIGITS = 2;
const MINOR_PER_MAJOR = 100n;

const LOCALES: Record<CostCurrency, string> = { INR: "en-IN", USD: "en-US" };
const SYMBOLS: Record<CostCurrency, string> = { INR: "₹", USD: "$" };

export function currencySymbol(currency: CostCurrency): string {
  return SYMBOLS[currency];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * "1,234.5", "₹ 1,23,456.78", "$12" → minor units. Accepts digit-group commas, spaces and
 * the currency's own symbol or code; at most 2 decimals; no sign (amounts are ≥ 0).
 */
export function parseMoney(text: string, currency: CostCurrency): ParseResult<number> {
  let value = text.trim();
  for (const prefix of [SYMBOLS[currency], currency]) {
    if (value.toUpperCase().startsWith(prefix)) value = value.slice(prefix.length).trim();
  }
  value = value.replace(/[,\s]/g, "");
  if (value === "") return { ok: false, error: "Enter an amount" };
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match || (match[1] === "" && !match[2])) {
    return { ok: false, error: "Enter an amount such as 1,234.50" };
  }
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > MINOR_DIGITS) {
    return { ok: false, error: `Use at most ${MINOR_DIGITS} decimals` };
  }
  const minor =
    BigInt(whole || "0") * MINOR_PER_MAJOR + BigInt((fraction + "00").slice(0, MINOR_DIGITS));
  if (minor > BigInt(MAX_AMOUNT_MINOR)) return { ok: false, error: "That amount is too large" };
  return { ok: true, value: Number(minor) };
}

/** Minor units → "1234.56" (exact decimal text, for CSV and `Intl` input). */
export function minorToDecimal(minor: number): string {
  assertMinor(minor);
  const value = BigInt(minor);
  const whole = value / MINOR_PER_MAJOR;
  const fraction = (value % MINOR_PER_MAJOR).toString().padStart(MINOR_DIGITS, "0");
  return `${whole}.${fraction}`;
}

/** Minor units → plain input text: "1234.5" → "1234.50"; whole amounts drop ".00". */
export function minorToInput(minor: number): string {
  const decimal = minorToDecimal(minor);
  return decimal.endsWith(".00") ? decimal.slice(0, -3) : decimal;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: CostCurrency, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.NumberFormat(LOCALES[currency], {
      style: "currency",
      currency,
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: MINOR_DIGITS, maximumFractionDigits: MINOR_DIGITS }),
    });
    formatters.set(key, found);
  }
  return found;
}

/**
 * Minor units → "₹1,23,456.78" / "$1,234.56" (Indian grouping for INR). The number is
 * handed to Intl as a decimal string, which it formats exactly.
 */
export function formatMoney(minor: number, currency: CostCurrency): string {
  return formatter(currency, false).format(minorToDecimal(minor) as Intl.StringNumericLiteral);
}

/** Short form for chart axes: "₹1.2L", "$3.4K". */
export function formatMoneyCompact(minor: number, currency: CostCurrency): string {
  return formatter(currency, true).format(minorToDecimal(minor) as Intl.StringNumericLiteral);
}

function assertMinor(minor: number): void {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError("Money must be a non-negative integer number of minor units");
  }
}

const FX_PATTERN = new RegExp(
  `^(\\d{1,${FX_RATE_INTEGER_DIGITS}})(?:\\.(\\d{0,${FX_RATE_SCALE}}))?$`,
);
const FX_ONE = 10n ** BigInt(FX_RATE_SCALE);

/**
 * An FX rate as typed ("83.25") → its canonical `numeric(12,6)` text ("83.250000"). At
 * most 6 integer and 6 fraction digits, and > 0.
 */
export function parseFxRate(text: string): ParseResult<string> {
  // No digit-group commas: "83,25" must not silently become 8325.
  const value = text.trim();
  const match = FX_PATTERN.exec(value);
  if (!match) return { ok: false, error: "Enter a rate such as 83.25 (up to 6 decimals)" };
  const [, whole = "0", fraction = ""] = match;
  const micro = BigInt(whole) * FX_ONE + BigInt(fraction.padEnd(FX_RATE_SCALE, "0"));
  if (micro === 0n) return { ok: false, error: "The rate must be more than 0" };
  return { ok: true, value: microToRate(micro) };
}

function rateToMicro(rate: string): bigint {
  const parsed = parseFxRate(rate);
  if (!parsed.ok) throw new RangeError(`Invalid FX rate: ${parsed.error}`);
  const [whole = "0", fraction = ""] = parsed.value.split(".");
  return BigInt(whole) * FX_ONE + BigInt(fraction);
}

function microToRate(micro: bigint): string {
  return `${micro / FX_ONE}.${(micro % FX_ONE).toString().padStart(FX_RATE_SCALE, "0")}`;
}

/** Integer division rounding half-up (both operands ≥ 0). */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Converts an amount to the base currency: `amount × rate`, rounded half-up to a whole
 * minor unit (both currencies have 2 minor digits, so minor × rate = base minor). Exact:
 * BigInt all the way. Returns null when the result is over `MAX_AMOUNT_MINOR`.
 */
export function convertToBase(amountMinor: number, rate: string): number | null {
  assertMinor(amountMinor);
  const base = divideHalfUp(BigInt(amountMinor) * rateToMicro(rate), FX_ONE);
  return base > BigInt(MAX_AMOUNT_MINOR) ? null : Number(base);
}

/**
 * The rate from `from` to `to`, given the project's "1 USD = x INR" default: x for
 * USD → INR, 1 / x (rounded half-up to 6 decimals) for INR → USD, null without a default
 * or for the same currency (no rate needed).
 */
export function defaultRate(
  from: CostCurrency,
  to: CostCurrency,
  usdToInr: string | null,
): string | null {
  if (from === to || usdToInr === null) return null;
  if (from === "USD") return parseFxRate(usdToInr).ok ? microToRate(rateToMicro(usdToInr)) : null;
  const micro = rateToMicro(usdToInr);
  // 1 / x at 6 decimals (half-up): e.g. 1 / 83.25 = 0.012012, about 5 significant digits
  // (≤ 0.004% off). Only a pre-fill; the entry's rate stays editable.
  const inverse = divideHalfUp(FX_ONE * FX_ONE, micro);
  const max = 10n ** BigInt(FX_RATE_INTEGER_DIGITS + FX_RATE_SCALE) - 1n;
  return inverse === 0n || inverse > max ? null : microToRate(inverse);
}

/** A rate for display: "83.25" (trailing zeros dropped). */
export function formatRate(rate: string): string {
  return rate.includes(".") ? rate.replace(/\.?0+$/, "") : rate;
}

/** The monthly run-rate share of a yearly amount: amount / 12, rounded half-up (COST-4). */
export function amortiseYearly(minor: number): number {
  assertMinor(minor);
  return Number(divideHalfUp(BigInt(minor), 12n));
}

/**
 * Change from `previous` to `current` in percent (one decimal), or null when there is no
 * previous amount to compare with (missing or 0).
 */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  // Integer maths, then one division: basis points of a tenth of a percent.
  const tenths = Math.round(((current - previous) * 1000) / previous);
  return tenths / 10;
}
