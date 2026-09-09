import type { Prospect } from './types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export type ScoreBreakdown = {
  portfolio: number;
  meterOpportunity: number;
  publicData: number;
  waterExposure: number;
  anomaly: number;
  reachability: number;
  total: number;
};

export function scoreProspect(prospect: Prospect): number {
  return scoreBreakdown(prospect).total;
}

export function scoreBreakdown(prospect: Prospect): ScoreBreakdown {
  const portfolio = clamp01(prospect.portfolioBuildings / 40) * 20;
  const meterOpportunity = clamp01(prospect.meterOpportunity) * 20;
  const publicData = clamp01(prospect.publicDataCoverage) * 15;
  const waterExposure = clamp01(prospect.annualWaterExposure / 400000) * 20;
  const anomaly = clamp01(prospect.anomalySignal) * 15;
  const reachability = clamp01(prospect.reachability) * 10;
  const total = Math.round(portfolio + meterOpportunity + publicData + waterExposure + anomaly + reachability);

  return {
    portfolio: Math.round(portfolio),
    meterOpportunity: Math.round(meterOpportunity),
    publicData: Math.round(publicData),
    waterExposure: Math.round(waterExposure),
    anomaly: Math.round(anomaly),
    reachability: Math.round(reachability),
    total,
  };
}

export function scoreBand(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 75) return 'High';
  if (score >= 55) return 'Medium';
  return 'Low';
}
