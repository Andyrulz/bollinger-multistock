import { parseUniverseCsv } from '../../src/data/OfficialUniverseProvider';

describe('official universe parser', () => {
  test('rejects an incomplete universe rather than scanning a partial list', () => {
    const csv = 'Company Name,Industry,Symbol,Series,ISIN Code\nExample Ltd,Technology,EXAMPLE,EQ,INE000000001';
    expect(() => parseUniverseCsv(csv)).toThrow('Official universe validation failed');
  });

  test('rejects a changed CSV schema', () => {
    expect(() => parseUniverseCsv('Symbol,Industry\nABC,Technology')).toThrow('missing column');
  });
});
