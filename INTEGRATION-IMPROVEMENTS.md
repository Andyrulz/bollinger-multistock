## Add to index.ts - Instrument Status Endpoint

```typescript
// Add this endpoint after the existing execution endpoints
this.app.get("/execution/instruments-status", (req: Request, res: Response) => {
  try {
    if (!this.authService.isAuthenticated()) {
      res.status(401).json({
        error: "Not authenticated",
        message: "Please visit /auth/login to authenticate first",
      });
      return;
    }

    const tradeExecutionService =
      this.breakoutStrategy.getTradeExecutionService();
    const instrumentsStatus = tradeExecutionService.getInstrumentsStatus();

    res.json({
      success: true,
      instruments_status: instrumentsStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    this.logger.error("Error getting instruments status:", error);
    res.status(500).json({
      error: "Failed to get instruments status",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
```

## Add to TradeExecutionService.ts

```typescript
public getInstrumentsStatus(): {
  loaded: boolean;
  count: number;
  loadedAt?: Date;
  sampleInstruments?: any[];
} {
  return {
    loaded: this.niftyInstruments.length > 0,
    count: this.niftyInstruments.length,
    loadedAt: this.niftyInstruments.length > 0 ? new Date() : undefined,
    sampleInstruments: this.niftyInstruments.slice(0, 5) // First 5 for preview
  };
}
```
