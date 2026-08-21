import { describe, expect, it } from 'vitest'
import { calculatePairMeasurements, detectLaneRects, measureRect, summarizeByGroup, type ImageDocument, type LaneAssignment, type PairMeasurement } from './measurement'

const image: ImageDocument = { fileName: 'fixture.png', width: 4, height: 2, bitDepth: 8, channel: '灰度亮度', source: 'demo', pixels: new Uint8Array([200, 200, 200, 200, 100, 100, 200, 200]) }
const lane: LaneAssignment = { id: 'lane-1', index: 1, targetRect: { x: 0, y: 1, width: 2, height: 1 }, loadingRect: { x: 0, y: 1, width: 2, height: 1 }, sample: 'S1', group: 'Control', replicate: '1' }
const summaryMeasurement = (group: string, value: number | null, index: number): PairMeasurement => ({ lane: { id: `lane-${index}`, index, targetRect: { x: 0, y: 0, width: 1, height: 1 }, loadingRect: { x: 0, y: 0, width: 1, height: 1 }, sample: `S${index}`, group, replicate: String(index) }, target: null, loading: null, targetCorrected: null, loadingCorrected: null, normalized: null, relativeExpression: value, qc: [] })

describe('WB paired image measurement', () => {
  it('calculates area, mean and raw integrated density', () => expect(measureRect(image, lane.targetRect)).toMatchObject({ area: 2, meanGray: 100, rawIntDen: 200 }))
  it('detects the requested number of lane rectangles', () => expect(detectLaneRects(image, { x: 0, y: 0, width: 4, height: 2 }, 2, 'dark')).toHaveLength(2))
  it('pairs target and loading images using selected polarity', () => { const background = { x: 0, y: 0, width: 2, height: 1 }; const result = calculatePairMeasurements(image, image, [lane], background, background, 'dark', 'Control'); expect(result.measurements[0].targetCorrected).toBe(200); expect(result.measurements[0].normalized).toBe(1); expect(result.measurements[0].relativeExpression).toBe(1) })
  it('summarizes relative expression by group with n, mean, sd and sem', () => {
    const measurements = [summaryMeasurement('Control', 1, 1), summaryMeasurement('Control', 1.2, 2), summaryMeasurement('Treated', 2, 3), summaryMeasurement('Treated', 2.4, 4), summaryMeasurement('Treated', 2.6, 5), summaryMeasurement('Treated', null, 6)]
    const summaries = summarizeByGroup(measurements)
    expect(summaries.map((summary) => summary.group)).toEqual(['Control', 'Treated'])
    expect(summaries[0].n).toBe(2)
    expect(summaries[0].mean).toBeCloseTo(1.1, 6)
    expect(summaries[0].sd).toBeCloseTo(0.141421, 5)
    expect(summaries[0].sem).toBeCloseTo(0.1, 6)
    expect(summaries[1].n).toBe(3)
    expect(summaries[1].mean).toBeCloseTo(7 / 3, 6)
    expect(summaries[1].sd).toBeCloseTo(0.305505, 4)
    expect(summaries[1].sem).toBeCloseTo(0.176383, 4)
  })
})
