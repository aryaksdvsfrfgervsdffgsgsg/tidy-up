// World-currency support: every ISO 4217 code can be picked as an auction's
// listing currency. Live conversion for display uses Frankfurter (ECB rates,
// no API key required), which covers the major/actively-traded currencies —
// roughly 30 of them. For a listing currency outside that set we still show
// the amount correctly in its own currency; we just can't convert it into a
// different one until a rate is available, and say so in the UI.

export const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "INR", "JPY", "CNY", "AUD", "CAD", "CHF", "HKD",
  "SGD", "SEK", "NOK", "DKK", "NZD", "MXN", "ZAR", "BRL", "RUB", "KRW",
  "TRY", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "JOD", "ILS", "EGP",
  "PKR", "BDT", "LKR", "NPR", "MMK", "THB", "VND", "IDR", "MYR", "PHP",
  "TWD", "PLN", "CZK", "HUF", "RON", "BGN", "HRK", "ISK", "UAH", "KZT",
  "ARS", "CLP", "COP", "PEN", "UYU", "BOB", "PYG", "VES", "DOP", "GTQ",
  "CRC", "PAB", "HNL", "NIO", "JMD", "TTD", "BBD", "BSD", "XCD", "NGN",
  "GHS", "KES", "TZS", "UGX", "ETB", "MAD", "DZD", "TND", "LYD", "ZMW",
  "MZN", "AOA", "XOF", "XAF", "RWF", "MWK", "BWP", "NAD", "MUR", "SCR",
  "FJD", "PGK", "WST", "TOP", "SBD", "VUV", "BND", "MNT", "KHR", "LAK",
  "AFN", "AZN", "AMD", "GEL", "BYN", "MDL", "ALL", "MKD", "RSD", "BAM",
  "IQD", "IRR", "YER", "LBP", "SYP", "SDG", "SSP", "ERN", "DJF",
  "SOS", "GMD", "GNF", "SLL", "LRD", "CVE", "STN", "KMF", "MGA", "SZL",
  "LSL", "BIF", "CDF", "XPF", "TMT", "UZS", "KGS", "TJS", "BTN", "MVR",
  "KYD", "BMD", "AWG", "ANG", "SRD", "GYD", "HTG", "CUP",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

let displayNames: Intl.DisplayNames | null = null;
function nameFormatter() {
  if (typeof Intl === "undefined" || !("DisplayNames" in Intl)) return null;
  if (!displayNames) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "currency" });
    } catch {
      displayNames = null;
    }
  }
  return displayNames;
}

export function currencyLabel(code: string): string {
  const name = nameFormatter()?.of(code);
  return name && name !== code ? `${code} — ${name}` : code;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export type RateTable = { base: string; rates: Record<string, number>; fetchedAt: number };
let cachedRates: RateTable | null = null;
let inflightFetch: Promise<RateTable | null> | null = null;

// Fetches once per session (rates move slowly) and caches in memory.
async function loadRates(): Promise<RateTable | null> {
  if (cachedRates && Date.now() - cachedRates.fetchedAt < 1000 * 60 * 60) return cachedRates;
  if (inflightFetch) return inflightFetch;
  inflightFetch = fetch("https://api.frankfurter.dev/v1/latest?base=USD")
    .then(async (res) => {
      if (!res.ok) throw new Error("rate fetch failed");
      const data = (await res.json()) as { base: string; rates: Record<string, number> };
      cachedRates = { base: data.base, rates: { ...data.rates, USD: 1 }, fetchedAt: Date.now() };
      return cachedRates;
    })
    .catch(() => null)
    .finally(() => {
      inflightFetch = null;
    });
  return inflightFetch;
}

/** Converts an amount from one currency to another using cached USD-based rates. Returns null if a rate isn't available yet. */
export function convert(amount: number, from: string, to: string, rates: RateTable | null): number | null {
  if (!rates) return from === to ? amount : null;
  if (from === to) return amount;
  const fromRate = rates.rates[from];
  const toRate = rates.rates[to];
  if (!fromRate || !toRate) return null;
  const usd = amount / fromRate;
  return usd * toRate;
}

export async function ensureRates(): Promise<RateTable | null> {
  return loadRates();
}

export function getCachedRates(): RateTable | null {
  return cachedRates;
}

/** Best-effort INR equivalent of an amount, used only to decide whether the
 * ₹10L payment-acknowledgement checkbox is required. Not used for money movement. */
export async function toInrEstimate(amount: number, currency: string): Promise<number | null> {
  if (currency === "INR") return amount;
  const rates = await ensureRates();
  return convert(amount, currency, "INR", rates);
}
