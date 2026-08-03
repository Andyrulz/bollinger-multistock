/**
 * Sector Index Instrument Tokens
 * Source: NSE INDICES segment via KiteConnect
 *
 * CRITICAL: These are NOT tradingsymbols - they are instrument_token values
 * Use with kite.getQuote([token]) not kite.getQuote("NIFTY BANK")
 */

export const SECTOR_TOKENS: Record<string, number> = {
  "NIFTY 50": 256265,
  "NIFTY BANK": 260105,
  "NIFTY IT": 259849,
  "NIFTY AUTO": 257289,
  "NIFTY METAL": 258313,
  "NIFTY INFRA": 257801,
  "NIFTY ENERGY": 256521,
  "NIFTY FMCG": 257033,
  "NIFTY PHARMA": 258569,
  "NIFTY PSU BANK": 261129,
  "NIFTY FIN SERVICE": 257545,
  "NIFTY CONSUMER DURABLES": 261641,
  "NIFTY REALTY": 260617,
  "NIFTY HEALTHCARE": 260873,
  "NIFTY MEDIA": 258057,
};

// Type-safe accessor
export function getSectorToken(sectorName: string): number | null {
  return SECTOR_TOKENS[sectorName] || null;
}

// Reverse lookup (token → name)
export function getSectorName(token: number): string | null {
  const entry = Object.entries(SECTOR_TOKENS).find(([_, t]) => t === token);
  return entry ? entry[0] : null;
}
