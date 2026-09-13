import { useRef, useState } from 'react'
import { CheckCircle2, Copy, Download, ShieldCheck } from 'lucide-react'
import type { QPCRProject, SimulationResult } from '../models'
import { mean } from '../domain/qpcr'
import { summaryTSV } from '../features/export'
import { dataProjectName } from '../features/export/raw'
import { exportSvgElement } from './chartExport'
import { chartNumericAxis, formatChartTick, wrapChartLabel } from '../../chartDisplay'
import { useChartWidth } from '../../useChartWidth'
import './results.css'

export const formatNumber = (value: number | null | undefined, digits = 4) => value == null || !Number.isFinite(value) ? '—' : Math.abs(value) >= 1e6 || (Math.abs(value) < 0.0001 && value !== 0) ? value.toExponential(2) : Number(value.toFixed(digits)).toString()
export const formatP = (value: number | null) => value === null ? '不适用' : value === 0 ? '< 1e-15' : value < 0.0001 ? value.toExponential(2) : value.toFixed(4)
const palette = ['#b9dfea', '#9fc0de', '#f7d5ca', '#edc1cd', '#ccdfb3', '#cec3e3', '#ecdbac', '#b5dbd1']

export function ResultsPanel({ project, result, geneId, onGeneChange, notify }: {
  project: QPCRProject; result: SimulationResult; geneId: string; onGeneChange: (geneId: string) => void; notify: (text: string) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { ref: chartRef, width: chartWidth } = useChartWidth()
  const [details, setDetails] = useState(false)
  const [tableView, setTableView] = useState<'fold' | 'calculation'>('fold')
  const target = project.genes.find(g => g.id === geneId)
  const calibrator = project.groups.find(group => group.isCalibrator)
  const samples = result.samples.filter(sample => sample.geneId === geneId)
  const groups = project.groups.map(group => ({ ...group, result: result.groups.find(g => g.groupId === group.id && g.geneId === geneId), samples: samples.filter(sample => sample.groupId === group.id) }))
  const comparisons = result.comparisons.filter(c => c.geneId === geneId && project.comparisons.some(selected => selected.id === c.id && selected.leftGroupId === c.leftGroupId && selected.rightGroupId === c.rightGroupId))
  const visibleComparisons = comparisons.filter(c => c.p !== null && Number.isFinite(c.p) && groups.some(group => group.id === c.leftGroupId) && groups.some(group => group.id === c.rightGroupId)).sort((a, b) => {
    const span = (comparison: typeof a) => Math.abs(groups.findIndex(g => g.id === comparison.leftGroupId) - groups.findIndex(g => g.id === comparison.rightGroupId))
    return span(a) - span(b)
  })
  const axis = chartNumericAxis(groups.flatMap(group => {
    const value = group.result
    const sd = value && Number.isFinite(value.sd) ? value.sd : 0
    return [...(value ? [value.mean, value.mean - sd, value.mean + sd, ...value.folds] : []), ...group.samples.map(sample => sample.fold)]
  }), { includeZero: true, padding: 0.1, targetTicks: 6 })
  const left = Math.max(68, ...axis.ticks.map(tick => formatChartTick(tick, axis.interval).length * 7 + 30))
  const width = Math.max(280, chartWidth, groups.length > 5 ? left + 24 + groups.length * 72 : 0)
  const right = width - 24
  // Comparisons get their own rows above the data area; no result or annotation is omitted.
  const top = 36 + visibleComparisons.length * 28
  const bottom = top + Math.max(250, Math.min(350, Math.round(chartWidth * 0.54)))
  const spacing = (right - left) / Math.max(groups.length, 1)
  const groupLabels = groups.map(group => wrapChartLabel(group.name, Math.max(6, Math.min(18, Math.floor(spacing / 7)))).split('\n'))
  const height = bottom + Math.max(1, ...groupLabels.map(lines => lines.length)) * 16 + 44
  const x = (index: number) => left + spacing * (index + 0.5)
  const y = (value: number) => bottom - ((value - axis.min) / (axis.max - axis.min)) * (bottom - top)
  const failures = result.qc.filter(q => q.level === 'fail')
  const warnings = result.qc.filter(q => q.level === 'warning')
  const status = failures.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS'
  const statusClass = failures.length ? 'fail' : warnings.length ? 'warning' : 'pass'
  const replicates = Math.max(0, ...groups.map(g => project.replicateMode === 'biological' ? g.biologicalReplicates : g.technicalReplicates))
  const exportChart = async (format: 'png' | 'svg') => {
    const name = dataProjectName(project)
    try { if (svgRef.current) await exportSvgElement(svgRef.current, `${name}-${target?.name}-表达量`, format); notify(`${format.toUpperCase()} 图片已导出`) } catch (error) { notify(String(error)) }
  }
  const copy = async () => {
    const cell = (value: string | number) => {
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
      const text = value.replace(/[\t\r\n]+/g, ' ')
      return /^\s*[=+\-@]/.test(text) ? `'${text}` : text
    }
    const text = tableView === 'fold' ? summaryTSV(project, result, geneId) : [
      ['Gene', target?.name ?? geneId],
      ['分析单位', project.replicateMode === 'biological' ? '独立生物样本；Cq 已聚合技术复孔' : '技术复孔；仅供教学预览'],
      ['分组', '样本 ID', '重复', '内参 Cq', '目的 Cq', 'ΔCq', 'ΔΔCq', '倍数', '技术 n'],
      ...samples.map(sample => [project.groups.find(group => group.id === sample.groupId)?.name ?? sample.groupId, sample.id, `R${sample.replicate}`, sample.referenceCq, sample.targetCq, sample.deltaCq, sample.deltaDeltaCq, sample.fold, sample.technicalN]),
    ].map(row => row.map(cell).join('\t')).join('\r\n')
    try { await navigator.clipboard.writeText(text); notify(`已复制${tableView === 'fold' ? '表达量表' : '计算明细'}，可粘贴到 Excel 或 Prism`) } catch { notify('浏览器未允许剪贴板访问，请使用 XLSX 导出') }
  }
  return <aside className="results-column results-preview-column">
    <section className="card result-card">
      <div className="section-heading result-heading"><div><span className="section-number">5</span><div className="result-heading-text"><h2>结果预览</h2><p>柱：均值；误差线：SD；黑点：{project.replicateMode === 'biological' ? '生物样本' : '技术复孔'}</p></div></div><span className="pill">模拟数据</span></div>
      <div className="result-topline"><select aria-label="预览目的基因" value={geneId} onChange={e => onGeneChange(e.target.value)}>{project.genes.filter(g => g.type === 'target').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><div className="chart-actions"><button className="btn btn-small" onClick={() => exportChart('png')}><Download size={13}/> PNG</button><button className="btn btn-small" onClick={() => exportChart('svg')}>SVG</button></div></div>
      {project.replicateMode === 'technical' && <div className="notice warning result-warning">技术复孔模式：p 值仅作教学预览，不构成独立样本统计推断。</div>}
      <div ref={chartRef} className="expression-chart">
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${target?.name} 相对表达量柱状图`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ width: '100%', height: 'auto', minWidth: width, display: 'block' }} fontFamily="Arial, Microsoft YaHei, sans-serif" fontSize="12" fill="#181818">
          <rect width={width} height={height} fill="white"/>
          {axis.ticks.map(tick => <g key={tick} data-testid="expression-y-tick"><line x1={left - 5} y1={y(tick)} x2={left} y2={y(tick)} stroke="#171717" strokeWidth="1"/><text x={left - 10} y={y(tick) + 4} textAnchor="end">{formatChartTick(tick, axis.interval)}</text></g>)}
          <path data-testid="expression-axes" d={`M${left} ${top} V${bottom} M${left} ${y(0)} H${right}`} stroke="#171717" strokeWidth="1.5" fill="none"/>
          <text transform={`translate(19 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="13">2⁻ΔΔCq ({target?.name})</text>
          {groups.map((g, i) => {
            const value = g.result
            const barW = Math.min(64, spacing * 0.57)
            const errorSD = value && Number.isFinite(value.sd) ? value.sd : 0
            return <g key={g.id}>
              {value && Number.isFinite(value.mean) ? <>
                <rect data-testid="expression-bar" x={x(i) - barW / 2} y={Math.min(y(value.mean), y(0))} width={barW} height={Math.abs(y(0) - y(value.mean))} fill={palette[i % palette.length]} stroke="#1b1b1b" strokeWidth="1.6"/>
                <line data-testid="expression-error" x1={x(i)} y1={y(value.mean - errorSD)} x2={x(i)} y2={y(value.mean + errorSD)} stroke="#171717" strokeWidth="1.3"/>
                {[value.mean - errorSD, value.mean + errorSD].map((v, j) => <line key={j} x1={x(i) - 7} x2={x(i) + 7} y1={y(v)} y2={y(v)} stroke="#171717" strokeWidth="1.3"/>)}
                {g.samples.filter(sample => Number.isFinite(sample.fold)).map((sample, j) => <circle key={sample.id} data-testid="expression-point" cx={x(i) + (((j + 0.5) * 0.61803398875 % 1) - 0.5) * Math.min(barW * 0.22, 13)} cy={y(sample.fold)} r={g.samples.length > 20 ? 2.4 : 4.2} fill="#202020" fillOpacity="0.87"><title>{`${g.name} · R${sample.replicate}: ${formatNumber(sample.fold)}`}</title></circle>)}
              </> : <text x={x(i)} y={bottom - 16} textAnchor="middle" fontSize="10" fill="#777">无有效数据</text>}
              <text data-testid="expression-group-label" x={x(i)} y={bottom + 22} textAnchor="middle" fontSize="12"><title>{g.name}</title>{groupLabels[i].map((line, index) => <tspan key={index} x={x(i)} dy={index ? 16 : 0}>{line}</tspan>)}</text>
            </g>
          })}
          {visibleComparisons.map((comparison, i) => {
            const a = x(groups.findIndex(g => g.id === comparison.leftGroupId)); const b = x(groups.findIndex(g => g.id === comparison.rightGroupId)); const cy = top - 14 - i * 28
            return <g key={comparison.id} data-testid="expression-comparison"><path d={`M${a} ${cy + 6} V${cy} H${b} V${cy + 6}`} stroke="#222" fill="none" strokeWidth="1.2"/><text x={(a + b) / 2} y={cy - 7} textAnchor="middle" fontSize="11"><tspan fontWeight="600">{comparison.label}</tspan><tspan> · p {comparison.p === 0 ? '< 1e-15' : `= ${formatP(comparison.p)}`}</tspan></text></g>
          })}
          <text data-export-omit="true" x={right} y={height - 9} textAnchor="end" fontSize="9" fill="#89928f">SIMULATED · {project.replicateMode === 'biological' ? 'biological samples' : 'technical preview'}</text>
        </svg>
      </div>
      <div className="notice result-normalization"><span><strong>标准 {calibrator?.name ?? 'CTRL'} 校准：</strong>以对照组平均 ΔCq 为基线；对照的几何均值为 1，算术均值可略偏离 1。</span></div>
      <div className="result-data-panel">
        <div className="table-heading"><div className="result-table-title"><h3>绘图与计算数据</h3><span>{target?.name} · 最终 Cq 回算</span></div><span className={`status status-${statusClass} result-integrity`} title="全项目的计算与质量规则检查">计算完整性：{status}</span><div className="result-data-actions"><div className="result-table-tabs" aria-label="结果数据视图"><button className={tableView === 'fold' ? 'active' : ''} aria-pressed={tableView === 'fold'} onClick={() => setTableView('fold')}>倍数数据</button><button className={tableView === 'calculation' ? 'active' : ''} aria-pressed={tableView === 'calculation'} onClick={() => setTableView('calculation')}>计算明细</button></div><button className="btn btn-small" onClick={copy}><Copy size={13}/> 复制表格</button></div></div>
        <div className="table-scroll result-data-scroll">{tableView === 'fold' ? <table className="results-table" data-testid="expression-table"><thead><tr><th>分组</th>{Array.from({ length: replicates }, (_, i) => <th key={i}>R{i + 1}</th>)}<th>算术均值</th><th>样本 SD</th><th>几何均值</th></tr></thead><tbody>{groups.map(g => <tr key={g.id}><th>{g.name}</th>{Array.from({ length: replicates }, (_, i) => <td key={i}>{formatNumber(g.samples.find(sample => sample.replicate === i + 1)?.fold)}</td>)}<td>{formatNumber(g.result?.mean)}</td><td>{formatNumber(g.result?.sd)}</td><td>{formatNumber(g.result?.geometricMean)}</td></tr>)}</tbody></table> : <table className="results-table calculation-table" data-testid="calculation-table"><thead><tr><th>分组 / 样本</th><th>内参 Cq</th><th>目的 Cq</th><th>ΔCq</th><th>ΔΔCq</th><th>倍数</th><th>技术 n</th></tr></thead><tbody>{groups.flatMap(group => group.samples.map(sample => <tr key={sample.id}><th title={sample.id}>{group.name} / R{sample.replicate}</th><td>{formatNumber(sample.referenceCq)}</td><td>{formatNumber(sample.targetCq)}</td><td>{formatNumber(sample.deltaCq)}</td><td>{formatNumber(sample.deltaDeltaCq)}</td><td>{formatNumber(sample.fold)}</td><td>{sample.technicalN}</td></tr>))}</tbody></table>}</div>
      </div>
      <p className="small muted result-data-note">{project.replicateMode === 'biological' ? 'R = 独立生物学样本（先聚合技术复孔）' : 'R = 技术复孔（预览）'} · 显示值四舍五入，计算保留完整精度</p>
      <div className="result-qc-panel">
        <div className="result-qc-heading"><span><ShieldCheck size={13}/> 计算与质量检查</span><span>{samples.length} 个有效{project.replicateMode === 'biological' ? '生物样本' : '复孔对'} · {warnings.length} 警告 · {failures.length} 异常</span></div>
        <div className="result-qc-groups">{groups.map(group => {
          const wells = result.wells.filter(well => well.groupId === group.id && well.geneId === geneId && !well.excluded)
          const cqValues = group.samples.map(sample => sample.targetCq).filter(Number.isFinite)
          const cqRange = cqValues.length ? Math.max(...cqValues) - Math.min(...cqValues) : Number.NaN
          const refId = project.genes.find(gene => gene.type === 'reference')?.id
          const abnormal = result.wells.filter(well => well.groupId === group.id && (well.geneId === geneId || well.geneId === refId) && well.qc.some(item => item.level !== 'pass')).length
          const average = (field: 'tm' | 'fwhm' | 'noise') => mean(wells.map(well => well.values[field]).filter(Number.isFinite))
          return <div className="result-qc-row" key={group.id}><strong>{group.name}</strong><dl><div title="分析单位的目的基因 Cq 标准差，生物模式下先聚合技术复孔"><dt>Cq SD</dt><dd>{formatNumber(group.result?.cqSD, 3)}</dd></div><div title="分析单位的目的基因 Cq 最大值减最小值"><dt>Cq 极差</dt><dd>{formatNumber(cqRange, 3)}</dd></div><div><dt>Tm 均值</dt><dd>{formatNumber(average('tm'), 2)} °C</dd></div><div><dt>FWHM 均值</dt><dd>{formatNumber(average('fwhm'), 2)} °C</dd></div><div><dt>噪声均值</dt><dd>{formatNumber(average('noise'), 4)}</dd></div><div title="当前目的基因与内参中被 QC 标记或排除的孔"><dt>异常孔</dt><dd>{abnormal}</dd></div></dl></div>
        })}</div>
        {!failures.length && !warnings.length ? <p className="qc-success"><CheckCircle2 size={13}/> 当前数据通过所配置的 QC 规则</p> : <div className="qc-findings">{[...failures, ...warnings].slice(0, details ? 200 : 4).map((q, i) => <p key={`${q.id}-${i}`} className={q.level}><strong>{q.level === 'fail' ? '异常' : '注意'}</strong> {q.message}</p>)}</div>}
        {failures.length + warnings.length > 4 && <button className="text-button" onClick={() => setDetails(!details)}>{details ? '收起检查详情' : `展开 ${failures.length + warnings.length} 项检查结果`}</button>}
        <p className="result-qc-note">技术复孔 Cq SD：警告 &gt; {project.simulation.cqWarningSD}，异常 &gt; {project.simulation.cqFailSD}。Tm、FWHM、噪声均来自当前模拟孔。</p>
      </div>
      <div className="statistics-list">{comparisons.map(c => <div key={c.id}><span>{project.groups.find(g => g.id === c.leftGroupId)?.name} <span className="muted">vs</span> {project.groups.find(g => g.id === c.rightGroupId)?.name}</span><strong>{c.label} <span className="mono">p {formatP(c.p)}</span></strong></div>)}</div>
      <p className="small muted result-test-note">Welch 双侧检验 · 基于 ΔCq · {project.simulation.correction === 'holm' ? 'Holm 校正（每个目的基因内）' : '未进行多重比较校正'}</p>
    </section>
  </aside>
}
