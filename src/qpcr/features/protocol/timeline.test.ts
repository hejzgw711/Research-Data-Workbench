import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../defaults'
import { protocolTimeline } from './timeline'

describe('PCR temperature timeline', () => {
  it('includes every repeated hold and inter-step ramp in elapsed seconds', () => {
    const p = createDefaultProject().protocol
    p.cycles = 3
    const timeline = protocolTimeline(p)
    const pre = 58 / 4.4 + 30
    const firstCycle = 10 + 35 / 2.2 + 30 + 12 / 4.4 + 20
    const nextCycle = 23 / 4.4 + firstCycle
    const melt = 23 / 4.4 + 10 + 35 / 2.2 + 60 + 35 / 0.2 + 1
    const cool = 58 / 2.2 + 30
    expect(timeline.totalSeconds).toBeCloseTo(pre + firstCycle + 2 * nextCycle + melt + cool, 9)
    expect(timeline.points.at(-1)?.temperature).toBe(37)
    expect(timeline.spans.map(span => span.name)).toEqual(['预变性', '扩增 × 3', '熔解', '冷却'])
  })

  it('changes runtime for two-step cycles and omits disabled cooling', () => {
    const p = createDefaultProject().protocol
    const full = protocolTimeline(p)
    p.mode = 'two-step'
    p.coolingEnabled = false
    const shorter = protocolTimeline(p)
    expect(shorter.totalSeconds).toBeLessThan(full.totalSeconds)
    expect(shorter.spans.some(span => span.name === '冷却')).toBe(false)
    expect(shorter.points.at(-1)?.temperature).toBe(95)
    expect(shorter.points.every((point, i) => i === 0 || point.seconds >= shorter.points[i - 1].seconds)).toBe(true)
  })

  it('responds to ramp and read density while leaving hold time consistent', () => {
    const p = createDefaultProject().protocol
    p.cycles = 1
    const first = protocolTimeline(p)
    p.meltEnd.rampRateCPerSec = 0.1
    p.readingsPerC = 10
    const second = protocolTimeline(p)
    expect(second.totalSeconds - first.totalSeconds).toBeCloseTo(175)
    expect(second.acquisitions.length - first.acquisitions.length).toBe(175)
  })
})
