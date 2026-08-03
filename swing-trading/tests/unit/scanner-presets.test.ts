import path from 'node:path';
import { defaultScanParameters, loadConfig, scannerPresets } from '../../src/config/loadConfig';

describe('consolidated scanner presets', () => {
  const config = loadConfig(path.resolve(__dirname, '../../config/scanner.json'));

  test('exposes exactly the three approved profiles', () => {
    const presets = scannerPresets(config);
    expect(presets.map((preset) => preset.name)).toEqual([
      'Low-Risk Momentum Entry',
      'Strict Minervini',
      'Broad Research',
    ]);
  });

  test('uses low-risk momentum as the operational default', () => {
    const defaults = defaultScanParameters(config);
    expect(defaults).toMatchObject({
      stageTwoMode: 'LOW_RISK',
      relativeStrengthPercentile: 70,
      minimumImpulseGain: 0.2,
      maximumFinalTightAreaDepth: 0.08,
      maximumPivotDistanceFromSma10: 0.04,
      maximumStructuralRisk: 0.06,
      requireVolumeContraction: true,
      requireRisingSma10: true,
      marketGateMode: 'WATCHLIST',
    });
  });

  test('keeps strict confirmation and broad research behavior distinct', () => {
    const presets = scannerPresets(config);
    const strict = presets.find((preset) => preset.id === 'strict-minervini')?.parameters;
    const broad = presets.find((preset) => preset.id === 'broad-research')?.parameters;
    expect(strict).toMatchObject({ stageTwoMode: 'STRICT', relativeStrengthPercentile: 80, marketGateMode: 'REQUIRED' });
    expect(broad).toMatchObject({
      stageTwoMode: 'RESEARCH', relativeStrengthPercentile: 65, marketGateMode: 'IGNORE',
      requireVolumeContraction: false, nearMissLimit: 50,
    });
  });
});
