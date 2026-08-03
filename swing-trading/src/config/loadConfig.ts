import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ScanParameters, ScannerConfig } from '../domain/types';

const positive = z.number().positive();
const fraction = z.number().min(0).max(1);
const schema = z.object({
  version: z.string().min(1),
  universeUrl: z.string().url(),
  minimumPrice: positive,
  minimumHistorySessions: z.number().int().min(220),
  minimumAverageTradedValue: positive,
  relativeStrengthPercentile: z.number().min(0).max(100),
  relativeStrengthLookback: z.number().int().min(60),
  relativeStrengthSlopeSessions: z.number().int().min(2),
  impulseLookbackSessions: z.number().int().min(20),
  minimumImpulseGain: fraction,
  minimumAccumulationDays: z.number().int().min(1),
  minimumVolumeDominance: positive,
  minimumTighteningSessions: z.number().int().min(3),
  maximumTighteningSessions: z.number().int().min(3),
  maximumTighteningDepth: fraction,
  minimumFinalTightAreaSessions: z.number().int().min(3),
  maximumFinalTightAreaSessions: z.number().int().max(20),
  maximumFinalTightAreaDepth: fraction,
  maximumPivotDistanceFromSma10: fraction,
  minimumUpperHalfCloses: z.number().int().min(1).max(10),
  maximumAtrContraction: z.number().min(0.1).max(2),
  requireVolumeContraction: z.boolean(),
  requireRisingSma10: z.boolean(),
  maximumStructuralRisk: fraction,
  sectorPercentileThreshold: z.number().min(0).max(100),
  maximumDataAgeCalendarDays: z.number().int().min(0),
  topCandidates: z.number().int().min(1).max(100),
}).refine((value) => value.minimumTighteningSessions <= value.maximumTighteningSessions, 'Invalid tightening window')
  .refine((value) => value.minimumFinalTightAreaSessions <= value.maximumFinalTightAreaSessions, 'Invalid final-tight-area window');

export function loadConfig(configPath = process.env.SWING_SCANNER_CONFIG ?? './config/scanner.json'): ScannerConfig {
  const absolutePath = path.resolve(configPath);
  return schema.parse(JSON.parse(fs.readFileSync(absolutePath, 'utf8')));
}

export const scanParametersSchema = z.object({
  stageTwoMode: z.enum(['LOW_RISK', 'STRICT', 'RESEARCH']),
  minimumPrice: z.number().min(1).max(100_000),
  minimumAverageTradedValue: z.number().min(100_000).max(100_000_000_000),
  relativeStrengthPercentile: z.number().min(0).max(100),
  relativeStrengthSlopeSessions: z.number().int().min(2).max(60),
  minimumImpulseGain: z.number().min(0).max(2),
  minimumAccumulationDays: z.number().int().min(1).max(20),
  minimumVolumeDominance: z.number().min(0.1).max(10),
  maximumTighteningDepth: z.number().min(0.01).max(0.5),
  minimumFinalTightAreaSessions: z.number().int().min(2).max(20),
  maximumFinalTightAreaSessions: z.number().int().min(2).max(30),
  maximumFinalTightAreaDepth: z.number().min(0.01).max(0.3),
  maximumPivotDistanceFromSma10: z.number().min(0).max(0.25),
  minimumUpperHalfCloses: z.number().int().min(1).max(10),
  maximumAtrContraction: z.number().min(0.1).max(2),
  requireVolumeContraction: z.boolean(),
  requireRisingSma10: z.boolean(),
  maximumStructuralRisk: z.number().min(0.005).max(0.25),
  sectorPercentileThreshold: z.number().min(0).max(100),
  topCandidates: z.number().int().min(1).max(100),
  nearMissLimit: z.number().int().min(0).max(100),
  marketGateMode: z.enum(['REQUIRED', 'WATCHLIST', 'IGNORE']),
}).refine((value) => value.minimumFinalTightAreaSessions <= value.maximumFinalTightAreaSessions, {
  message: 'Minimum FTA sessions cannot exceed maximum FTA sessions',
});

export function defaultScanParameters(config: ScannerConfig): ScanParameters {
  return scanParametersSchema.parse({
    stageTwoMode: 'LOW_RISK',
    minimumPrice: config.minimumPrice,
    minimumAverageTradedValue: config.minimumAverageTradedValue,
    relativeStrengthPercentile: 70,
    relativeStrengthSlopeSessions: config.relativeStrengthSlopeSessions,
    minimumImpulseGain: 0.2,
    minimumAccumulationDays: config.minimumAccumulationDays,
    minimumVolumeDominance: config.minimumVolumeDominance,
    maximumTighteningDepth: config.maximumTighteningDepth,
    minimumFinalTightAreaSessions: config.minimumFinalTightAreaSessions,
    maximumFinalTightAreaSessions: config.maximumFinalTightAreaSessions,
    maximumFinalTightAreaDepth: 0.08,
    maximumPivotDistanceFromSma10: 0.04,
    minimumUpperHalfCloses: config.minimumUpperHalfCloses,
    maximumAtrContraction: 0.8,
    requireVolumeContraction: config.requireVolumeContraction,
    requireRisingSma10: config.requireRisingSma10,
    maximumStructuralRisk: 0.06,
    sectorPercentileThreshold: config.sectorPercentileThreshold,
    topCandidates: 20,
    nearMissLimit: 30,
    marketGateMode: 'WATCHLIST',
  });
}

export function scannerPresets(config: ScannerConfig): Array<{ id: string; name: string; parameters: ScanParameters }> {
  const defaults = defaultScanParameters(config);
  return [
    { id: 'low-risk-momentum', name: 'Low-Risk Momentum Entry', parameters: {
      ...defaults,
    } },
    { id: 'strict-minervini', name: 'Strict Minervini', parameters: {
      ...defaults, stageTwoMode: 'STRICT', relativeStrengthPercentile: config.relativeStrengthPercentile,
      minimumImpulseGain: config.minimumImpulseGain, maximumFinalTightAreaDepth: config.maximumFinalTightAreaDepth,
      maximumPivotDistanceFromSma10: config.maximumPivotDistanceFromSma10,
      maximumAtrContraction: config.maximumAtrContraction, maximumStructuralRisk: config.maximumStructuralRisk,
      topCandidates: config.topCandidates, nearMissLimit: 20, marketGateMode: 'REQUIRED',
    } },
    { id: 'broad-research', name: 'Broad Research', parameters: {
      ...defaults, stageTwoMode: 'RESEARCH', relativeStrengthPercentile: 65,
      minimumImpulseGain: 0.15, maximumTighteningDepth: 0.2,
      maximumFinalTightAreaDepth: 0.12, maximumPivotDistanceFromSma10: 0.08,
      minimumUpperHalfCloses: 2, maximumAtrContraction: 1.2,
      maximumStructuralRisk: 0.08, sectorPercentileThreshold: 40,
      requireVolumeContraction: false, requireRisingSma10: false,
      marketGateMode: 'IGNORE', topCandidates: 30, nearMissLimit: 50,
    } },
  ];
}
