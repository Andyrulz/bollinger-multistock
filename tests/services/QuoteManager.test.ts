/**
 * Unit Tests for QuoteManager
 * Tests Publisher-Subscriber pattern and polling logic
 */

import { QuoteManager } from "../../src/services/QuoteManager";
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
}

describe("QuoteManager", () => {
  let quoteManager: QuoteManager;
  let mockKite: MockKiteConnect;
  let mockLogger: MockLogger;

  beforeEach(() => {
    jest.useFakeTimers();
    mockKite = new MockKiteConnect();
    mockLogger = new MockLogger();
    quoteManager = new QuoteManager(
      mockKite as any,
      mockLogger as any as Logger,
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("subscribe()", () => {
    it("should add subscriber to map", () => {
      const callback = jest.fn();
      quoteManager.subscribe("NSE:RELIANCE", callback);

      const stats = quoteManager.getStats();
      expect(stats.subscriberCount).toBe(1);
      expect(stats.symbols).toContain("NSE:RELIANCE");
    });

    it("should auto-start polling when first subscriber added", () => {
      const callback = jest.fn();
      quoteManager.subscribe("NSE:RELIANCE", callback);

      const stats = quoteManager.getStats();
      expect(stats.isPolling).toBe(true);
    });

    it("should handle multiple subscribers to same symbol", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      quoteManager.subscribe("NSE:RELIANCE", callback1);
      quoteManager.subscribe("NSE:RELIANCE", callback2);

      const stats = quoteManager.getStats();
      expect(stats.subscriberCount).toBe(1); // Same symbol
    });

    it("should handle multiple different symbols", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      quoteManager.subscribe("NSE:RELIANCE", callback1);
      quoteManager.subscribe("NSE:TCS", callback2);

      const stats = quoteManager.getStats();
      expect(stats.subscriberCount).toBe(2);
      expect(stats.symbols).toContain("NSE:RELIANCE");
      expect(stats.symbols).toContain("NSE:TCS");
    });
  });

  describe("unsubscribe()", () => {
    it("should remove subscriber", () => {
      const callback = jest.fn();
      quoteManager.subscribe("NSE:RELIANCE", callback);
      quoteManager.unsubscribe("NSE:RELIANCE", callback);

      const stats = quoteManager.getStats();
      expect(stats.subscriberCount).toBe(0);
    });

    it("should auto-stop polling when last subscriber removed", () => {
      const callback = jest.fn();
      quoteManager.subscribe("NSE:RELIANCE", callback);

      let stats = quoteManager.getStats();
      expect(stats.isPolling).toBe(true);

      quoteManager.unsubscribe("NSE:RELIANCE", callback);

      stats = quoteManager.getStats();
      expect(stats.isPolling).toBe(false);
    });

    it("should keep polling if other subscribers exist", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      quoteManager.subscribe("NSE:RELIANCE", callback1);
      quoteManager.subscribe("NSE:TCS", callback2);

      quoteManager.unsubscribe("NSE:RELIANCE", callback1);

      const stats = quoteManager.getStats();
      expect(stats.isPolling).toBe(true);
      expect(stats.subscriberCount).toBe(1);
    });
  });

  describe("fetchAndPublish()", () => {
    it("should call kite.getQuote with all symbols", async () => {
      const callback = jest.fn();

      mockKite.getQuote.mockResolvedValue({
        "NSE:RELIANCE": { last_price: 2500 },
        "NSE:TCS": { last_price: 3500 },
      });

      quoteManager.subscribe("NSE:RELIANCE", callback);
      quoteManager.subscribe("NSE:TCS", callback);

      // Trigger polling
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockKite.getQuote).toHaveBeenCalledWith([
        "NSE:RELIANCE",
        "NSE:TCS",
      ]);
    });

    it("should publish quotes to callbacks", async () => {
      const callback = jest.fn();

      mockKite.getQuote.mockResolvedValue({
        "NSE:RELIANCE": { last_price: 2500 },
      });

      quoteManager.subscribe("NSE:RELIANCE", callback);

      // Trigger polling
      await jest.advanceTimersByTimeAsync(1000);

      expect(callback).toHaveBeenCalledWith({ last_price: 2500 });
    });

    it("should handle API errors gracefully", async () => {
      const callback = jest.fn();

      mockKite.getQuote.mockRejectedValue(new Error("Network error"));

      quoteManager.subscribe("NSE:RELIANCE", callback);

      // Trigger polling
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });

    it("should stop polling after 10 consecutive errors", async () => {
      const callback = jest.fn();

      mockKite.getQuote.mockRejectedValue(new Error("Network error"));

      quoteManager.subscribe("NSE:RELIANCE", callback);

      // Trigger 10 polling cycles
      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(1000);
      }

      const stats = quoteManager.getStats();
      expect(stats.isPolling).toBe(false);
      expect(stats.consecutiveErrors).toBe(10);
    });

    it("should reset error count on successful fetch", async () => {
      const callback = jest.fn();

      // First fail, then succeed
      mockKite.getQuote
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue({
          "NSE:RELIANCE": { last_price: 2500 },
        });

      quoteManager.subscribe("NSE:RELIANCE", callback);

      // Trigger 2 polling cycles
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(1000);

      const stats = quoteManager.getStats();
      expect(stats.consecutiveErrors).toBe(0);
    });
  });

  describe("getStats()", () => {
    it("should return accurate polling state", () => {
      const stats1 = quoteManager.getStats();
      expect(stats1.isPolling).toBe(false);

      const callback = jest.fn();
      quoteManager.subscribe("NSE:RELIANCE", callback);

      const stats2 = quoteManager.getStats();
      expect(stats2.isPolling).toBe(true);
    });

    it("should detect stale data after 5 seconds", async () => {
      const callback = jest.fn();

      mockKite.getQuote.mockResolvedValue({
        "NSE:RELIANCE": { last_price: 2500 },
      });

      quoteManager.subscribe("NSE:RELIANCE", callback);

      // First fetch
      await jest.advanceTimersByTimeAsync(1000);

      let stats = quoteManager.getStats();
      expect(stats.dataStale).toBe(false);

      // Now mock API failure and wait 6 seconds
      mockKite.getQuote.mockRejectedValue(new Error("Network error"));
      await jest.advanceTimersByTimeAsync(6000);

      stats = quoteManager.getStats();
      expect(stats.dataStale).toBe(true);
      expect(stats.lastFetchAge).toBeGreaterThan(5000);
    });
  });

  describe("shutdown()", () => {
    it("should stop polling and clear subscribers", async () => {
      const callback = jest.fn();
      quoteManager.subscribe("NSE:RELIANCE", callback);

      await quoteManager.shutdown();

      const stats = quoteManager.getStats();
      expect(stats.isPolling).toBe(false);
      expect(stats.subscriberCount).toBe(0);
    });
  });

  describe("callback error handling", () => {
    it("should catch errors in callbacks and continue", async () => {
      const failingCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const workingCallback = jest.fn();

      mockKite.getQuote.mockResolvedValue({
        "NSE:RELIANCE": { last_price: 2500 },
      });

      quoteManager.subscribe("NSE:RELIANCE", failingCallback);
      quoteManager.subscribe("NSE:RELIANCE", workingCallback);

      // Trigger polling
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(workingCallback).toHaveBeenCalled();
    });
  });
});
