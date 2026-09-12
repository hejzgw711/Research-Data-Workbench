import { init } from 'echarts'
import type { EChartsOption, EChartsType } from 'echarts'
import JSZip from 'jszip'
import type { QPCRProject, SimulationResult, Well } from '../../models'
import { amplificationCurve, meltingCurve } from '../../domain/qpcr'
import { downloadBlob } from '../export'

export type CurveKind = 'amplification' | 'melting'
const COLORS = ['#6691b7', '#b2b94c', '#777084', '#cc9754', '#66aeb3', '#9f93bf', '#92b7ac', '#c19eae']

export function curveChartOption(project: QPCRProject, wells: Well[], kind: CurveKind, legend = true, selectedKey?: string): EChartsOption {
  const amplification = kind === 'amplification'
  return {
    animation: false,
    backgroundColor: '#ffffff',
    graphic: [{ type: 'text', right: 28, top: 9, silent: true, style: { text: 'SIMULATED / 模拟数据', fill: '#91a79e', fontSize: 10 } }],
    tooltip: { trigger: 'item', valueFormatter: value => typeof value === 'number' ? value.toFixed(4) : String(value) },
    legend: { show: legend, type: 'scroll', bottom: 0, textStyle: { fontSize: 9, color: '#75817c' }, pageIconColor: '#718ca4', itemWidth: 10, itemHeight: 8, itemGap: 9, pageIconSize: 10 },
    grid: { top: 34, bottom: legend ? 54 : 35, left: 52, right: 23 },
    xAxis: { type: 'value', name: amplification ? 'Cycle' : '温度 / °C', nameLocation: 'middle', nameGap: 27, min: amplification ? 1 : project.protocol.meltLow.temperatureC, max: amplification ? project.protocol.cycles : project.protocol.meltEnd.temperatureC, splitLine: { lineStyle: { color: '#edf0ef' } }, axisLine: { show: true, lineStyle: { color: '#89928e' } }, axisLabel: { color: '#65726e' } },
    yAxis: { type: 'value', name: amplification ? 'Fluorescence (a.u.)' : '−dF/dT (a.u./°C)', min: project.simulation.curveModel === 'reference-v1' ? value => Math.min(0, value.min) : 0, nameTextStyle: { color: '#65726e', fontSize: 11 }, splitLine: { lineStyle: { color: '#e8eeeb' } }, axisLabel: { color: '#65726e', formatter: (value: number) => Number(value.toFixed(2)).toString() } },
    series: wells.map(well => {
      const groupIndex = Math.max(0, project.groups.findIndex(group => group.id === well.groupId))
      const geneIndex = Math.max(0, project.genes.findIndex(gene => gene.id === well.geneId))
      const points = amplification ? amplificationCurve(well, project) : meltingCurve(well, project)
      const group = project.groups[groupIndex]?.name ?? well.groupId
      const gene = project.genes[geneIndex]?.name ?? well.geneId
      const color = COLORS[(groupIndex * 2 + geneIndex + well.technicalReplicate - 1) % COLORS.length]
      return {
        name: `${well.wellId} · ${group} · ${gene} · B${well.biologicalReplicate} T${well.technicalReplicate}`,
        type: 'line', symbol: 'none', showSymbol: false,
        data: points.map(point => [point.x, point.y]),
        lineStyle: { color, width: well.key === selectedKey ? 1.7 : 0.85, opacity: well.key === selectedKey ? 0.82 : 0.3, type: geneIndex % 2 ? 'dashed' : 'solid' },
        itemStyle: { color },
        emphasis: { focus: 'series', lineStyle: { width: 2.5, opacity: 1 } },
      }
    }),
  }
}

export async function exportCurveChart(chart: EChartsType, format: 'png' | 'svg', filename: string) {
  const svg = chart.renderToSVGString()
  if (format === 'svg') {
    downloadBlob(svg, `${filename}.svg`, 'image/svg+xml;charset=utf-8')
    return
  }
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = svgUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(chart.getWidth() * 2)
    canvas.height = Math.ceil(chart.getHeight() * 2)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器暂不支持 PNG 绘图导出')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 导出失败')), 'image/png'))
    downloadBlob(blob, `${filename}.png`)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

export async function exportCurveBatch(project: QPCRProject, result: SimulationResult) {
  const zip = new JSZip()
  for (let plateIndex = 0; plateIndex < result.plateCount; plateIndex++) {
    await new Promise(resolve => setTimeout(resolve, 0))
    const wells = result.wells.filter(well => well.plateIndex === plateIndex && !well.excluded)
    for (const kind of ['amplification', 'melting'] as const) {
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 1050, height: 560 })
      try {
        chart.setOption(curveChartOption(project, wells, kind))
        zip.file(`plate-${plateIndex + 1}-${kind}.svg`, chart.renderToSVGString())
      } finally { chart.dispose() }
      for (const well of wells) {
        const points = kind === 'amplification' ? amplificationCurve(well, project) : meltingCurve(well, project)
        const csv = [`${kind === 'amplification' ? 'cycle,fluorescence' : 'temperature_c,negative_df_dt'}`, ...points.map(point => `${point.x},${point.y}`)].join('\r\n')
        zip.file(`plate-${plateIndex + 1}/${well.wellId}-${kind}.csv`, csv)
      }
    }
  }
  zip.file('README.txt', `qRT-PCR Data Studio — SIMULATED DATA\r\nProject: ${project.name}\r\nRandom seed: ${project.randomSeed}\r\nCurve model: ${project.simulation.curveModel ?? 'legacy-v1'}\r\nEach plate includes SVG amplification and melting plots plus per-well raw curve CSV files.\r\nSignal units: synthetic a.u.; melting derivative a.u./degree C.\r\nExcluded wells are omitted. Curves are deterministic synthetic models, not instrument measurements.\r\n`)
  downloadBlob(await zip.generateAsync({ type: 'blob' }), 'qpcr-all-plate-curves.zip')
}
