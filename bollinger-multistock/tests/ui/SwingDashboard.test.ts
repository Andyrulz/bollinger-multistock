import { formatTradingViewWatchlist, renderSwingDashboard } from '../../src/ui/SwingDashboard';

describe('Swing dashboard TradingView export', () => {
  test('formats unique NSE symbols in TradingView comma-separated TXT format', () => {
    expect(formatTradingViewWatchlist([
      'RELIANCE', 'nse:tcs', 'RELIANCE', 'M&M', 'BAJAJ-AUTO', '', '  INFY  ',
    ])).toBe('NSE:RELIANCE,NSE:TCS,NSE:M&M,NSE:BAJAJ_AUTO,NSE:INFY');
  });

  test('renders a disabled download button and client-side export behavior', () => {
    const html = renderSwingDashboard('/tradebot-multistock', true, 'Trader');

    expect(html).toContain('id="downloadTradingView"');
    expect(html).toContain('Download TradingView list');
    expect(html).toContain("symbols.join(',')");
    expect(html).toContain("link.download='swing-scanner-'+date+'.txt'");
    expect(html).toContain("replace(/-/g,'_')");
    expect(html).toContain("document.getElementById('downloadTradingView').addEventListener('click',downloadTradingView)");
  });
});
