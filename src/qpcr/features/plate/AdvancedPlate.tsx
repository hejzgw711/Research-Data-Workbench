import { useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Archive, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { ProjectUpdater, QPCRProject, SimulationResult, WellValues } from '../../models'
import { NumericInput } from '../../components/NumericInput'
import { curveChartOption, exportCurveBatch, exportCurveChart } from './chartExports'
import type { CurveKind } from './chartExports'
import '../panels.css'

function CurvePanel({ title, kind, project, wells, legend, selectedKey, notify }: {
  title: string; kind: CurveKind; project: QPCRProject; wells: SimulationResult['wells']; legend: boolean; selectedKey?: string; notify: (message: string) => void
}) {
  const chartRef = useRef<ReactECharts>(null)
  const option = useMemo(() => curveChartOption(project, wells, kind, legend, selectedKey), [project, wells, kind, legend, selectedKey])
  const save = async (format: 'png' | 'svg') => {
    try {
      if (!chartRef.current) throw new Error('图表尚未准备好')
      await exportCurveChart(chartRef.current.getEchartsInstance(), format, `plate-${(wells[0]?.plateIndex ?? 0) + 1}-${kind}`)
      notify(`已导出${title} ${format.toUpperCase()}`)
    } catch (error) { notify(error instanceof Error ? error.message : '图表导出失败') }
  }
  return <div className="plate-curve-panel"><div className="plate-curve-heading"><strong>{title}</strong><div><button className="btn btn-small" aria-label={`导出${title} PNG`} onClick={() => void save('png')}>PNG</button><button className="btn btn-small" aria-label={`导出${title} SVG`} onClick={() => void save('svg')}>SVG</button></div></div><ReactECharts ref={chartRef} option={option} notMerge opts={{ renderer: 'svg' }} style={{ height: 305 }} />{wells.length === 0 && <div className="plate-empty-chart">当前范围内没有可显示的曲线</div>}</div>
}

export function AdvancedPlate({ project, result, update, notify }: { project: QPCRProject; result: SimulationResult; update: ProjectUpdater; notify: (message: string) => void }) {
  const [requestedPlate, setRequestedPlate] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(result.wells[0]?.key ?? null)
  const [scope, setScope] = useState('all')
  const [display, setDisplay] = useState('combination')
  const [legend, setLegend] = useState(true)
  const [exporting, setExporting] = useState(false)
  const plateIndex = Math.min(requestedPlate, Math.max(0, result.plateCount - 1))
  const plateWells = useMemo(() => result.wells.filter(well => well.plateIndex === plateIndex), [result.wells, plateIndex])
  const selectedWell = plateWells.find(well => well.key === selectedKey)
  const occupied = new Map(plateWells.map(well => [well.wellId, well]))
  const filteredWells = useMemo(() => plateWells.filter(well => !well.excluded && (scope === 'all' || (scope === 'selected' ? well.key === selectedWell?.key : well.geneId === scope))), [plateWells, scope, selectedWell?.key])
  const changeWell = (key: keyof WellValues, value: number) => {
    if (!selectedWell) return
    update(next => { next.manualOverrides[selectedWell.key] = { ...next.manualOverrides[selectedWell.key], [key]: value } })
  }
  const resetSelected = () => {
    if (!selectedWell) return
    update(next => { delete next.manualOverrides[selectedWell.key] })
    notify(`已恢复 ${selectedWell.wellId} 的生成值及包含状态`)
  }
  const batch = async () => {
    setExporting(true)
    try { await exportCurveBatch(project, result); notify(`已导出 ${result.plateCount} 块孔板的曲线 SVG 与逐孔原始 CSV`) }
    catch (error) { notify(error instanceof Error ? error.message : '批量曲线导出失败') }
    finally { setExporting(false) }
  }
  return <section className="card advanced-plate">
    <div className="section-heading"><div><h2><SlidersHorizontal size={21} /> 自动排板与曲线浏览器</h2><p className="muted">支持全板、基因或单孔查看；选中孔后可微调参数，曲线与分析同步更新。</p></div><label className="plate-select-label"><span>孔板</span><select aria-label="选择孔板" value={plateIndex} onChange={e => { setRequestedPlate(Number(e.target.value)); setSelectedKey(result.wells.find(well => well.plateIndex === Number(e.target.value))?.key ?? null) }}>{Array.from({ length: result.plateCount || 1 }, (_, i) => <option key={i} value={i}>Plate {i + 1}</option>)}</select></label></div>
    <div className="plate-controls"><label>范围<select aria-label="曲线范围" value={scope} onChange={e => setScope(e.target.value)}><option value="all">全板</option><option value="selected">选中孔</option>{project.genes.map(gene => <option key={gene.id} value={gene.id}>{gene.name}</option>)}</select></label><label>显示<select aria-label="孔板显示方式" value={display} onChange={e => setDisplay(e.target.value)}><option value="combination">组合</option><option value="group">分组</option><option value="gene">基因</option><option value="cq">Cq</option></select></label><label className="plate-legend-toggle"><input type="checkbox" checked={legend} onChange={e => setLegend(e.target.checked)} />图例</label><div className="plate-export-controls"><span>{filteredWells.length} 条曲线</span><button className="btn btn-primary btn-small" disabled={exporting} onClick={() => void batch()}><Archive size={15} />{exporting ? '正在打包…' : '全部孔板 ZIP'}</button></div></div>
    <div className="plate-workspace">
      <div className="plate-left"><div className="plate-grid-scroll"><div className="plate-grid" aria-label={`Plate ${plateIndex + 1} 96 孔板`}>
        <span />{Array.from({ length: 12 }, (_, column) => <span className="plate-col-label" key={`col-${column}`}>{column + 1}</span>)}
        {'ABCDEFGH'.split('').map(row => <div className="plate-row" key={row}><span className="plate-row-label">{row}</span>{Array.from({ length: 12 }, (_, col) => {
          const wellId = `${row}${col + 1}`
          const well = occupied.get(wellId)
          const groupIndex = Math.max(0, project.groups.findIndex(group => group.id === well?.groupId))
          const group = project.groups[groupIndex]?.name ?? ''
          const gene = project.genes.find(g => g.id === well?.geneId)?.name ?? ''
          const warning = well?.qc.some(item => item.level !== 'pass')
          const selected = well?.key === selectedWell?.key && Boolean(well)
          return <button key={wellId} type="button" className={`plate-well ${well ? 'assigned' : 'empty'} ${selected ? 'selected' : ''} ${well?.excluded ? 'excluded' : ''} ${warning ? 'warning' : ''} ${well?.adjusted ? 'adjusted' : ''}`}
            aria-label={`${wellId}${well ? ` ${group} ${gene} Cq ${well.values.cq.toFixed(3)}${well.excluded ? ' 已排除' : ''}${warning ? ' QC 异常' : ''}${well.adjusted ? ' 已微调' : ''}` : ' 空孔'}`} aria-pressed={selected}
            title={well ? `${wellId} · ${group} · ${gene}\n生物重复 ${well.biologicalReplicate} / 技术重复 ${well.technicalReplicate}${well.qc.length ? `\n${well.qc.map(item => item.message).join('\n')}` : ''}` : `${wellId} · 未分配`}
            onClick={() => setSelectedKey(well?.key ?? null)}>
            <small>{wellId}</small>{well ? <>{(display === 'combination' || display === 'group') && <strong>{group}</strong>}{(display === 'combination' || display === 'gene') && <span>{gene}</span>}{(display === 'combination' || display === 'cq') && <b>{well.values.cq.toFixed(2)}</b>}{display !== 'combination' && <span>B{well.biologicalReplicate} · T{well.technicalReplicate}</span>}<em>{well.excluded ? '×' : warning ? '!' : well.adjusted ? '•' : ''}</em></> : <span className="plate-empty-mark">○</span>}
          </button>
        })}</div>)}
      </div></div>
      {legend && <div className="plate-state-legend"><span><i className="legend-assigned" />已分配</span><span><i className="legend-selected" />选中</span><span><i className="legend-adjusted" />• 已微调</span><span><i className="legend-warning" />! QC 异常</span><span><i className="legend-excluded" />× 已排除</span><span>○ 空孔</span></div>}
      <div className="selected-well-panel"><div className="selected-well-heading"><strong>{selectedWell ? `${selectedWell.wellId} · ${project.groups.find(group => group.id === selectedWell.groupId)?.name} · ${project.genes.find(gene => gene.id === selectedWell.geneId)?.name}` : '选择已分配的孔以查看和调整'}</strong>{selectedWell && <label><input type="checkbox" checked={selectedWell.excluded} onChange={e => update(next => { next.manualOverrides[selectedWell.key] = { ...next.manualOverrides[selectedWell.key], excluded: e.target.checked } })} />排除此孔</label>}</div>
        <div className="well-adjustments">{([{ key: 'cq', label: 'Cq', min: 1, max: 80 }, { key: 'tm', label: 'Tm °C', min: 20, max: 100 }, { key: 'plateau', label: '平台', min: 0.01, max: 100 }, { key: 'slope', label: '斜率', min: 0.01, max: 5 }, { key: 'noise', label: '噪声', min: 0, max: 1 }] as const).map(item => <label className="field" key={item.key}><span>{item.label}</span><NumericInput label={`选中孔${item.label}`} disabled={!selectedWell} value={selectedWell ? Number(selectedWell.values[item.key].toFixed(5)) : 0} min={item.min} max={item.max} step={item.key === 'noise' || item.key === 'slope' ? 'any' : 1} onChange={v => changeWell(item.key, v)} /></label>)}</div>
        <div className="well-action-buttons"><button className="btn btn-small" disabled={!selectedWell || !project.manualOverrides[selectedWell.key]} onClick={resetSelected}><RotateCcw size={14} />恢复该孔</button><button className="btn btn-small" disabled={Object.keys(project.manualOverrides).length === 0} onClick={() => { update(next => { next.manualOverrides = {} }); notify('已清除全部孔的微调与排除标记') }}>清除全部微调</button><span className="muted">保留原始生成值，可随时恢复</span></div>
        {selectedWell?.qc.filter(item => item.level !== 'pass').map(item => <p className="notice" key={item.id}>{item.message}</p>)}
      </div></div>
      <div className="plate-curves"><div className="plate-curves-title"><strong>Plate {plateIndex + 1} · {filteredWells.length} 条曲线 · 合成数据</strong></div><CurvePanel title="扩增曲线" kind="amplification" project={project} wells={filteredWells} legend={legend} selectedKey={selectedWell?.key} notify={notify} /><CurvePanel title="熔解曲线" kind="melting" project={project} wells={filteredWells} legend={legend} selectedKey={selectedWell?.key} notify={notify} /></div>
    </div>
  </section>
}
