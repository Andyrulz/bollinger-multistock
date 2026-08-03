import { linearSlope, median, percentileRank } from '../../src/screener/indicators';

describe('scanner indicators', () => {
  test('median handles odd and even populations', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test('percentile rank uses the deterministic midpoint method for ties', () => {
    expect(percentileRank(20, [10, 20, 20, 30])).toBe(50);
  });

  test('linear slope preserves direction', () => {
    expect(linearSlope([1, 2, 3, 4])).toBeGreaterThan(0);
    expect(linearSlope([4, 3, 2, 1])).toBeLessThan(0);
  });
});
