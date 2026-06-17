/**
 * Zerodha F&O Options Charges Calculator
 * 
 * Calculates all statutory and regulatory charges for NSE stock option trades.
 * Rates sourced from https://zerodha.com/charges (as of April 2026).
 * 
 * Our bot trades: NSE Stock Options (NFO-OPT), product type MIS (intraday)
 * Entry = BUY option, Exit = SELL option (for both LONG CE and SHORT PE)
 */

// --- Rate constants (update here when Zerodha revises charges) ---
const BROKERAGE_PER_ORDER = 20;              // ₹20 flat per executed order
const STT_OPTIONS_SELL_PCT = 0.15 / 100;     // 0.15% on sell-side premium turnover
const NSE_TXN_CHARGE_PCT = 0.03553 / 100;    // 0.03553% on premium turnover (both sides)
const SEBI_CHARGE_PER_CRORE = 10;            // ₹10 per crore of premium turnover
const STAMP_DUTY_BUY_PCT = 0.003 / 100;      // 0.003% on buy-side premium turnover
const IPFT_PER_CRORE = 0.01;                 // ₹0.01 per crore (negligible, included for completeness)
const GST_PCT = 18 / 100;                    // 18% on (brokerage + txn charges + SEBI charges)

export interface OrderCharges {
  brokerage: number;
  stt: number;
  txnCharges: number;
  sebiCharges: number;
  stampDuty: number;
  ipft: number;
  gst: number;
  total: number;
}

export interface TradeCharges {
  buy: OrderCharges;
  sell: OrderCharges;
  totalCharges: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate charges for a BUY order (option entry)
 * @param price - Option premium per unit
 * @param quantity - Total quantity (lots × lot_size)
 */
export function calculateBuyCharges(price: number, quantity: number): OrderCharges {
  const turnover = price * quantity;

  const brokerage = BROKERAGE_PER_ORDER; // Flat ₹20 per executed order for options
  const stt = 0; // No STT on option buy side
  const txnCharges = round2(turnover * NSE_TXN_CHARGE_PCT);
  const sebiCharges = round2(turnover * SEBI_CHARGE_PER_CRORE / 1_00_00_000);
  const stampDuty = round2(turnover * STAMP_DUTY_BUY_PCT);
  const ipft = round2(turnover * IPFT_PER_CRORE / 1_00_00_000);
  const gst = round2((brokerage + txnCharges + sebiCharges) * GST_PCT);

  const total = round2(brokerage + stt + txnCharges + sebiCharges + stampDuty + ipft + gst);

  return { brokerage: round2(brokerage), stt, txnCharges, sebiCharges, stampDuty, ipft, gst, total };
}

/**
 * Calculate charges for a SELL order (option exit)
 * @param price - Option premium per unit
 * @param quantity - Total quantity (lots × lot_size)
 */
export function calculateSellCharges(price: number, quantity: number): OrderCharges {
  const turnover = price * quantity;

  const brokerage = BROKERAGE_PER_ORDER; // Flat ₹20 per executed order for options
  const stt = round2(turnover * STT_OPTIONS_SELL_PCT);
  const txnCharges = round2(turnover * NSE_TXN_CHARGE_PCT);
  const sebiCharges = round2(turnover * SEBI_CHARGE_PER_CRORE / 1_00_00_000);
  const stampDuty = 0; // No stamp duty on sell side
  const ipft = round2(turnover * IPFT_PER_CRORE / 1_00_00_000);
  const gst = round2((brokerage + txnCharges + sebiCharges) * GST_PCT);

  const total = round2(brokerage + stt + txnCharges + sebiCharges + stampDuty + ipft + gst);

  return { brokerage: round2(brokerage), stt, txnCharges, sebiCharges, stampDuty, ipft, gst, total };
}

/**
 * Calculate total round-trip charges for a complete trade (BUY + SELL)
 * @param buyPrice - Entry option premium per unit
 * @param sellPrice - Exit option premium per unit
 * @param quantity - Total quantity (lots × lot_size)
 */
export function calculateRoundTripCharges(buyPrice: number, sellPrice: number, quantity: number): TradeCharges {
  const buy = calculateBuyCharges(buyPrice, quantity);
  const sell = calculateSellCharges(sellPrice, quantity);
  return {
    buy,
    sell,
    totalCharges: round2(buy.total + sell.total),
  };
}
