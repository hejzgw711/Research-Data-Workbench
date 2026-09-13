import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createDefaultProject } from '../defaults'
import type { QPCRProject, SimulationResult, Well, WellValues } from '../models'
import { amplificationCurve, meltingCurve } from '../domain/qpcr'
import { curveChartOption } from '../features/plate/chartExports'
import { ResultsPanel } from './ResultsPanel'

function fixture(count = 2, value = 1, sd = 0.2) {
  const project = createDefaultProject()
  project.groups = Array.from({ length: count }, (_, index) => ({ ...structuredClone(project.groups[0]), id: `g${index + 1}`, name: `Group ${index + 1}`, isCalibrator: index === 0 }))
  project.comparisons = []
  const result: SimulationResult = {
    wells: [], qc: [], totalWells: 0, plateCount: 1, comparisons: [],
    groups: project.groups.map(group => ({ groupId: group.id, geneId: 'target1', n: 1, mean: value, sd, geometricMean: value, folds: [value], deltaCqs: [0], cqSD: 0 })),
    samples: project.groups.map(group => ({ id: `${group.id}/1/target1`, groupId: group.id, geneId: 'target1', replicate: 1, referenceCq: 18, targetCq: 24, deltaCq: 6, deltaDeltaCq: 0, fold: value, technicalN: 3, inferential: true })),
  }
  return { project, result }
}

function expressionSvg(project: QPCRProject, result: SimulationResult) {
  const html = renderToStaticMarkup(createElement(ResultsPanel, { project, result, geneId: 'target1', onGeneChange: () => {}, notify: () => {} }))
  return html.match(/<svg[^>]*aria-label="IL-1 相对表达量柱状图"[^>]*>[\s\S]*?<\/svg>/)![0]
}

const tags = (svg: string, tag: string, testId: string) => [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*data-testid="${testId}"[^>]*>`, 'g'))].map(match => match[0])
const attribute = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))![1]

describe('qPCR display bounds and labels', () => {
  it('scales very small expression values without a 0.1 floor and leaves inputs untouched', () => {
    const { project, result } = fixture(2, 1e-9, 1e-10)
    const snapshot = structuredClone({ project, result })
    const svg = expressionSvg(project, result)
    expect(tags(svg, 'rect', 'expression-bar').every(bar => Number(attribute(bar, 'height')) > 100)).toBe(true)
    expect(svg).toMatch(/>\d+(?:\.\d+)?e-\d+</)
    expect(svg).not.toMatch(/NaN|Infinity/)
    expect({ project, result }).toEqual(snapshot)
  })

  it('keeps the negative SD endpoint and high outlying sample inside the data area', () => {
    const { project, result } = fixture(2, 1, 2)
    result.samples[0].fold = 8
    result.groups[0].folds = [8]
    const svg = expressionSvg(project, result)
    const axis = attribute(tags(svg, 'path', 'expression-axes')[0], 'd').match(/^M[\d.]+ ([\d.]+) V([\d.]+) M[\d.]+ ([\d.]+) H/)!
    const [top, bottom, zero] = axis.slice(1).map(Number)
    const error = tags(svg, 'line', 'expression-error')[0]
    expect(Number(attribute(error, 'y1'))).toBeGreaterThan(zero)
    for (const endpoint of ['y1', 'y2']) expect(Number(attribute(error, endpoint))).toBeGreaterThanOrEqual(top)
    expect(Number(attribute(error, 'y1'))).toBeLessThanOrEqual(bottom)
    for (const point of tags(svg, 'circle', 'expression-point')) {
      expect(Number(attribute(point, 'cy'))).toBeGreaterThanOrEqual(top)
      expect(Number(attribute(point, 'cy'))).toBeLessThanOrEqual(bottom)
    }
  })

  it('wraps every full group label and makes space for every selected p bracket', () => {
    const { project, result } = fixture(9)
    project.groups.forEach((group, index) => { group.name = `第${index + 1}组非常长的中文分组名称与完整英文Condition` })
    project.comparisons = project.groups.flatMap((left, i) => project.groups.slice(i + 1).map(right => ({ id: `${left.id}-${right.id}`, leftGroupId: left.id, rightGroupId: right.id })))
    result.comparisons = project.comparisons.map(comparison => ({ ...comparison, geneId: 'target1', rawP: 0.01, p: 0.02, statistic: 2.5, df: 4, label: '*', inferential: true, status: 'ok' }))
    const svg = expressionSvg(project, result)
    const labels = [...svg.matchAll(/<text data-testid="expression-group-label"[^>]*>([\s\S]*?)<\/text>/g)]
    expect(labels.map(label => [...label[1].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map(line => line[1]).join(''))).toEqual(project.groups.map(group => group.name))
    expect(tags(svg, 'g', 'expression-comparison')).toHaveLength(project.comparisons.length)
    expect(svg).not.toContain('…')
    const positions = [...svg.matchAll(/data-testid="expression-comparison"><path d="M[\d.]+ ([\d.]+) V([\d.]+)/g)]
    expect(positions.every(position => Number(position[2]) > 20)).toBe(true)
    expect(Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1])).toBeGreaterThan(1300)
    expect(svg).toContain('data-export-omit="true"')
    expect(svg).toContain('SIMULATED')
  })

  it('renders missing results with finite axes and no fabricated bars', () => {
    const { project, result } = fixture()
    result.groups = []; result.samples = []
    const svg = expressionSvg(project, result)
    expect(svg).not.toMatch(/NaN|Infinity/)
    expect(tags(svg, 'rect', 'expression-bar')).toHaveLength(0)
    expect(svg).toContain('无有效数据')
  })
})

describe('qPCR curve display bounds', () => {
  it.each(['legacy-v1', 'reference-v1'] as const)('keeps all %s signal points and readable small-value ticks', model => {
    const project = createDefaultProject()
    project.simulation.curveModel = model
    project.protocol.cqDetection.threshold = 1e-6
    const values: WellValues = { cq: 18, tm: 84, plateau: 1e-4, slope: 0.8, noise: 1e-7, baseline: 0, fwhm: 2.53 }
    const well: Well = { id: '1/A1', key: 'g1/1/target1/1', wellId: 'A1', plateIndex: 0, row: 'A', column: 1, groupId: 'g1', geneId: 'target1', sampleId: 'g1/1', biologicalReplicate: 1, technicalReplicate: 1, generated: values, values, excluded: false, adjusted: false, qc: [] }
    const snapshot = structuredClone({ project, well })
    for (const kind of ['amplification', 'melting'] as const) {
      const option = curveChartOption(project, [well], kind)
      const axis = option.yAxis as { min: number; max: number; interval: number; axisLabel: { formatter: (value: number) => string } }
      const expected = (kind === 'amplification' ? amplificationCurve(well, project) : meltingCurve(well, project)).map(point => [point.x, point.y])
      expect((option.series as { data: number[][] }[])[0].data).toEqual(expected)
      expect(axis.min).toBeLessThanOrEqual(Math.min(0, ...expected.map(point => point[1])))
      expect(axis.max).toBeGreaterThanOrEqual(Math.max(...expected.map(point => point[1])))
      expect(axis.axisLabel.formatter(axis.interval)).not.toBe('0')
      expect(axis.axisLabel.formatter(axis.interval)).not.toBe(axis.axisLabel.formatter(axis.interval * 2))
      const tooltip = option.tooltip as { valueFormatter: (value: number) => string }
      expect(Number(tooltip.valueFormatter(1e-6))).toBe(1e-6)
      expect(option.graphic).not.toEqual([])
      expect(curveChartOption(project, [well], kind, true, undefined, false).graphic).toEqual([])
    }
    expect({ project, well }).toEqual(snapshot)
  })

  it('retains the protocol X range and provides finite axes when no curves exist', () => {
    const project = createDefaultProject()
    project.protocol.cycles = 55
    project.protocol.meltLow.temperatureC = 55.5
    project.protocol.meltEnd.temperatureC = 98.5
    for (const kind of ['amplification', 'melting'] as const) {
      const option = curveChartOption(project, [], kind)
      const x = option.xAxis as { min: number; max: number }
      const y = option.yAxis as { min: number; max: number; interval: number }
      expect(x).toMatchObject(kind === 'amplification' ? { min: 1, max: 55 } : { min: 55.5, max: 98.5 })
      expect([y.min, y.max, y.interval].every(Number.isFinite)).toBe(true)
      expect(y.max).toBeGreaterThan(y.min)
    }
  })
})
