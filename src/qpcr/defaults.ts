import type { PCRStep, QPCRProject } from './models'
const step = (temperatureC: number, holdSeconds: number, rampRateCPerSec = 4.4, acquisition: PCRStep['acquisition'] = 'none'): PCRStep => ({ temperatureC, holdSeconds, rampRateCPerSec, acquisition })

export function createDefaultProject(): QPCRProject {
  return {
    id: 'qpcr-project', name: 'qRT-PCR 分组模拟实验', theme: 'light', randomSeed: 20260912,
    replicateMode: 'biological', inputMode: 'distribution',
    groups: ['CTRL', 'Treatment', 'Group 3', 'Group 4'].map((name, i) => ({
      id: `g${i + 1}`, name, isCalibrator: i === 0, biologicalReplicates: 3, technicalReplicates: 3,
      technicalCqSD: 0.12,
      targetFoldByGene: { target1: { mean: [1, 2, 3.5, 1.6][i], sd: [0.15, 0.3, 0.5, 0.25][i], sdMode: i === 0 ? 'auto' : 'manual' } },
    })),
    genes: [
      { id: 'ref1', name: 'ACTIN', type: 'reference', nominalCq: 18, tmC: 85.8, primerConcentration: 0.2, meltFwhmC: 2.53 },
      { id: 'target1', name: 'IL-1', type: 'target', nominalCq: 24, tmC: 84.3, primerConcentration: 0.2, meltFwhmC: 2.53 },
    ],
    comparisons: [2, 3, 4].map(i => ({ id: `c${i}`, leftGroupId: 'g1', rightGroupId: `g${i}` })),
    protocol: {
      mode: 'three-step', cycles: 40, preincubation: step(95, 30), denaturation: step(95, 10),
      annealing: step(60, 30, 2.2), extension: step(72, 20, 4.4, 'single'),
      meltHigh: step(95, 10), meltLow: step(60, 60, 2.2), meltEnd: step(95, 1, 0.2, 'continuous'),
      cooling: step(37, 30, 2.2), coolingEnabled: true, readingsPerC: 5,
      channel: 'SYBR Green', volume: 20, quantFactor: 20, meltFactor: 1.2, acquisitionMode: 'dynamic',
      cqDetection: { mode: 'baseline-delta-f', threshold: 0.1, baselineStartCycle: 3, baselineEndCycle: 10 },
    },
    simulation: { curveModel: 'reference-v1', preset: 'realistic', noiseLevel: 'medium', referenceCqSD: 0.2, fluorescenceNoise: 0.004, tmSD: 0.12, cqWarningSD: 0.3, cqFailSD: 0.5, tmWarning: 0.5, tmFail: 1, correction: 'holm' },
    manualOverrides: {}, manualCq: {}, rowSeeds: {},
  }
}
