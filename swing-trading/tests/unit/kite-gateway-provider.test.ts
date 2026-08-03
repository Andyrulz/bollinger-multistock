import { KiteReadOnlyDataProvider } from '../../src/data/KiteReadOnlyDataProvider';

describe('common-auth broker gateway provider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('uses the loopback gateway without credentials or authorization headers', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ instruments: [{ instrument_token: 123, tradingsymbol: 'NIFTY MIDSMALLCAP 400' }] }),
      });
    global.fetch = fetchMock as typeof fetch;

    const provider = await KiteReadOnlyDataProvider.connect('http://127.0.0.1:3003');
    await expect(provider.findInstrumentToken('NIFTY MIDSMALLCAP 400')).resolves.toBe(123);

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3003/auth/status', expect.objectContaining({ signal: expect.anything() }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3003/instruments/NSE', expect.objectContaining({ signal: expect.anything() }));
    for (const call of fetchMock.mock.calls) expect(call[1]).not.toHaveProperty('headers');
  });

  test('fails closed when the common session is unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Zerodha session is not authenticated' }),
    }) as typeof fetch;

    await expect(KiteReadOnlyDataProvider.connect()).rejects.toThrow('Zerodha session is not authenticated');
  });

  test('ignores malformed instruments and resolves the abbreviated MidSmallcap benchmark', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          instruments: [
            { instrument_token: 1 },
            { instrument_token: '266505', tradingsymbol: 'NIFTY MIDSML 400', name: 'NIFTY MIDSML 400', segment: 'INDICES' },
          ],
        }),
      }) as typeof fetch;

    const provider = await KiteReadOnlyDataProvider.connect();
    await expect(provider.findInstrumentToken('NIFTY MIDSMALLCAP 400')).resolves.toBe(266505);
  });

  test('preserves the NSE session date from IST daily candle timestamps', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candles: [{
          date: '2026-07-17T00:00:00.000+05:30', open: 100, high: 110, low: 90, close: 105, volume: 1000,
        }] }),
      }) as typeof fetch;

    const provider = await KiteReadOnlyDataProvider.connect();
    const candles = await provider.getDailyCandles(123, '2026-07-17', '2026-07-17');
    expect(candles[0]?.date).toBe('2026-07-17');
  });

  test('converts gateway UTC timestamps back to the NSE session date', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candles: [{
          date: '2026-07-16T18:30:00.000Z', open: 100, high: 110, low: 90, close: 105, volume: 1000,
        }] }),
      }) as typeof fetch;

    const provider = await KiteReadOnlyDataProvider.connect();
    const candles = await provider.getDailyCandles(123, '2026-07-17', '2026-07-17');
    expect(candles[0]?.date).toBe('2026-07-17');
  });
});
