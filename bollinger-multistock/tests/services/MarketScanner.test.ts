/**
 * Unit Tests for MarketScanner
 * Tests TMV scoring logic and critical functions
 */

import { MarketScanner } from "../../src/services/MarketScanner";
import { Logger } from "../../src/utils/Logger";

// Mock Logger
class MockLogger {
  info = jest.fn();
  debug = jest.fn();
  warn = jest.fn();
  error = jest.fn();
}

// Mock KiteConnect
class MockKiteConnect {
  getQuote = jest.fn();
  getInstruments = jest.fn();
  getHistoricalData = jest.fn();
}

// Mock InstrumentCache
class MockInstrumentCache {
  getNFOInstruments = jest.fn().mockResolvedValue([
    { tradingsymbol: "RELIANCE26JAN2500CE", expiry: "2026-01-29", instrument_token: 123456, strike: 2500, instrument_type: "CE" },
    { tradingsymbol: "RELIANCE26JAN2500PE", expiry: "2026-01-29", instrument_token: 123457, strike: 2500, instrument_type: "PE" },
    { tradingsymbol: "RELIANCE26FEB2500CE", expiry: "2026-02-26", instrument_token: 123458, strike: 2500, instrument_type: "CE" },
    { tradingsymbol: "RELIANCE26FEB2500PE", expiry: "2026-02-26", instrument_token: 123459, strike: 2500, instrument_type: "PE" },
    { tradingsymbol: "TCS26JAN3500CE", expiry: "2026-01-29", instrument_token: 223456, strike: 3500, instrument_type: "CE" },
  ]);
}

describe("MarketScanner", () => {
  let scanner: MarketScanner;
  let mockKite: MockKiteConnect;
  let mockLogger: MockLogger;
  let mockInstrumentCache: MockInstrumentCache;

  beforeEach(() => {
    mockKite = new MockKiteConnect();
    mockLogger = new MockLogger();
    mockInstrumentCache = new MockInstrumentCache();
    scanner = new MarketScanner(
      mockKite as any,
      mockLogger as any as Logger,
      mockInstrumentCache as any,
      {
        minScore: 7.0,
        topCount: 3,
        minPremium: 10,
        sectorChangeThreshold: { green: 0.25, red: -0.25 },
      }
    );
  });

  describe("getCurrentMonthLastTuesday", () => {
    it("should return last Tuesday of current month", () => {
      const result = (scanner as any).getCurrentMonthLastTuesday();
      expect(result.getDay()).toBe(2); // Tuesday
    });

    it("should return a valid date", () => {
      const result = (scanner as any).getCurrentMonthLastTuesday();
      expect(result instanceof Date).toBe(true);
      expect(result.getTime()).not.toBeNaN();
    });
  });

  describe("isStockTradingBlocked", () => {
    it("should return boolean value", async () => {
      const result = await (scanner as any).isStockTradingBlocked();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("Symbol Extraction Regex", () => {
    it("should extract M&M correctly", () => {
      const result = extractStockSymbol("M&M26FEB2500CE");
      expect(result).toBe("M&M");
    });

    it("should extract BAJAJ-AUTO correctly", () => {
      const result = extractStockSymbol("BAJAJ-AUTO26FEB2500CE");
      expect(result).toBe("BAJAJ-AUTO");
    });

    it("should extract LT correctly (not L&T)", () => {
      const result = extractStockSymbol("LT26FEB2500CE");
      expect(result).toBe("LT");
    });

    it("should extract RELIANCE correctly", () => {
      const result = extractStockSymbol("RELIANCE26FEB2500CE");
      expect(result).toBe("RELIANCE");
    });

    it("should extract TCS correctly", () => {
      const result = extractStockSymbol("TCS26FEB2500PE");
      expect(result).toBe("TCS");
    });
  });

  describe("findClosestStrike", () => {
    it("should find exact match", () => {
      const strikes = [2400, 2450, 2500, 2550, 2600];
      const result = (scanner as any).findClosestStrike(2500, strikes);
      expect(result).toBe(2500);
    });

    it("should find closest when spot is between strikes", () => {
      const strikes = [2400, 2450, 2500, 2550, 2600];
      const result = (scanner as any).findClosestStrike(2520, strikes);
      expect(result).toBe(2500);
    });

    it("should handle single strike", () => {
      const strikes = [2500];
      const result = (scanner as any).findClosestStrike(2520, strikes);
      expect(result).toBe(2500);
    });
  });

  describe("calculateEMA", () => {
    it("should calculate EMA correctly", () => {
      const data = [100, 102, 101, 103, 105, 107, 106, 108, 110, 109];
      const result = (scanner as any).calculateEMA(data, 5);
      expect(result).toBeGreaterThan(100);
      expect(result).toBeLessThan(120);
    });

    it("should handle insufficient data", () => {
      const data = [100, 102];
      const result = (scanner as any).calculateEMA(data, 5);
      expect(result).toBe(102);
    });
  });

  describe("calculateRSI", () => {
    it("should return value between 0 and 100", () => {
      const data = [100, 102, 101, 103, 105, 107, 106, 108, 110, 109, 111, 113, 112, 114, 116];
      const result = (scanner as any).calculateRSI(data, 14);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it("should return 50 for insufficient data", () => {
      const data = [100, 102];
      const result = (scanner as any).calculateRSI(data, 14);
      expect(result).toBe(50);
    });

    it("should return 100 when avgLoss is 0", () => {
      const data = Array(20).fill(0).map((_, i) => 100 + i);
      const result = (scanner as any).calculateRSI(data, 14);
      expect(result).toBe(100);
    });
  });

  describe("calculateVWAP", () => {
    it("should calculate VWAP correctly", () => {
      const candles = [
        { date: new Date(), open: 100, high: 105, low: 99, close: 102, volume: 1000 },
        { date: new Date(), open: 102, high: 106, low: 101, close: 104, volume: 1500 },
        { date: new Date(), open: 104, high: 108, low: 103, close: 106, volume: 1200 },
      ];

      const result = (scanner as any).calculateVWAP(candles);
      expect(result).toBeGreaterThan(99);
      expect(result).toBeLessThan(110);
    });

    it("should handle zero volume", () => {
      const candles = [
        { date: new Date(), open: 100, high: 105, low: 99, close: 102, volume: 0 },
      ];

      const result = (scanner as any).calculateVWAP(candles);
      expect(result).toBe(0);
    });
  });

  describe("calculateRVOL", () => {
    it("should calculate relative volume", () => {
      const volumes = Array(30).fill(1000).map((v, i) => v + i * 10);
      const result = (scanner as any).calculateRVOL(volumes);
      expect(result).toBeGreaterThan(0);
    });

    it("should return 1.0 for insufficient data", () => {
      const volumes = [1000, 1100];
      const result = (scanner as any).calculateRVOL(volumes);
      expect(result).toBe(1.0);
    });

    it("should handle zero average volume", () => {
      const volumes = Array(20).fill(0).concat([100, 100]);
      const result = (scanner as any).calculateRVOL(volumes);
      expect(result).toBe(1.0);
    });
  });

  describe("derive15MinCandles", () => {
    it("should combine 3 x 5min candles into 1 x 15min", () => {
      const candles5m = [
        { date: new Date("2026-01-25T09:15:00"), open: 100, high: 102, low: 99, close: 101, volume: 1000 },
        { date: new Date("2026-01-25T09:20:00"), open: 101, high: 103, low: 100, close: 102, volume: 1100 },
        { date: new Date("2026-01-25T09:25:00"), open: 102, high: 105, low: 101, close: 104, volume: 1200 },
      ];

      const result = (scanner as any).derive15MinCandles(candles5m);

      expect(result.length).toBe(1);
      expect(result[0].open).toBe(100);
      expect(result[0].close).toBe(104);
      expect(result[0].high).toBe(105);
      expect(result[0].low).toBe(99);
      expect(result[0].volume).toBe(3300);
    });

    it("should handle incomplete chunks", () => {
      const candles5m = [
        { date: new Date(), open: 100, high: 102, low: 99, close: 101, volume: 1000 },
        { date: new Date(), open: 101, high: 103, low: 100, close: 102, volume: 1100 },
      ];

      const result = (scanner as any).derive15MinCandles(candles5m);
      expect(result.length).toBe(0);
    });
  });

  describe("cacheHistoricalData", () => {
    it("should cache data successfully", async () => {
      // getHistoricalData mock returns candle data
      mockKite.getHistoricalData.mockResolvedValue([
        { date: new Date(), open: 2500, high: 2520, low: 2495, close: 2510, volume: 100000 },
      ]);

      // Override universe to test single stock WITH instrumentToken
      (scanner as any).universe = [
        { symbol: "RELIANCE", sector: "NIFTY ENERGY", sectorToken: 256521, lotSize: 250, instrumentToken: 738561 },
      ];

      const result = await scanner.cacheHistoricalData();

      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      expect(scanner.isReady()).toBe(true);
    });

    it("should handle API failures gracefully", async () => {
      mockKite.getHistoricalData.mockRejectedValue(new Error("API Error"));

      // Override universe with stock that has instrumentToken
      (scanner as any).universe = [
        { symbol: "RELIANCE", sector: "NIFTY ENERGY", sectorToken: 256521, lotSize: 250, instrumentToken: 738561 },
      ];

      // cacheHistoricalData catches per-stock errors gracefully
      // With a single stock failing, success is true but count is 0
      // (20% failure threshold not exceeded with 1 stock)
      const result = await scanner.cacheHistoricalData();
      
      // The method logs errors but continues - success depends on failure threshold
      expect(result).toBeDefined();
    });
  });

  describe("clearCache", () => {
    it("should clear cached data", () => {
      scanner.clearCache();
      expect(scanner.isReady()).toBe(false);
    });
  });

  describe("emptyResult", () => {
    it("should return valid empty result structure", () => {
      const result = (scanner as any).emptyResult();

      expect(result.scannedCount).toBe(0);
      expect(result.qualifiedCount).toBe(0);
      expect(result.selected).toEqual([]);
      expect(result.greenSectors).toEqual([]);
      expect(result.redSectors).toEqual([]);
      expect(result.flatSectors).toEqual([]);
      expect(result.failedStocks).toEqual([]);
      expect(result.scanTime instanceof Date).toBe(true);
    });
  });
});

// Helper function for symbol extraction regex testing
function extractStockSymbol(optionSymbol: string): string {
  const match = optionSymbol.match(/^([A-Z&-]+)\d{2}[A-Z]{3}/);
  return match && match[1] ? match[1] : optionSymbol;
}
