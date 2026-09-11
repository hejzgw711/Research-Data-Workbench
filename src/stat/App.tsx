import './styles.css'
import {
  AlertTriangle,
  BarChart3,
  Check,
  Copy,
  Download,
  FileArchive,
  FileDown,
  FolderOpen,
  Lock,
  LogOut,
  Plus,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import ReactECharts from 'echarts-for-react'
import { ResultChart } from './components/ResultChart'
import { cloneSettings, defaultSettings, ensurePairwiseConstraints, generateCandidates, syncTwoWayGroups } from './core/generator'
import { defaultTimeSeriesSettings, generateTimeSeriesCandidates, syncTimeSeriesCells } from './core/timeSeries'
import { copyPrismColumns, copyPrismGrouped, exportCsv, exportTimeSeriesCsv, exportTimeSeriesXlsx, exportTimeSeriesZip, exportXlsx, exportZip, saveProject, saveTimeSeriesProject } from './exporters'
import type { Candidate, GenerationReport, GeneratorSettings, GroupConfig, TimePointConfig, TimeSeriesCandidate, TimeSeriesCellConfig, TimeSeriesGenerationReport, TimeSeriesGeneratorSettings, TimeSeriesGroupConfig, TwoWayCellConfig, TwoWaySettings } from './models'

const colors = ['#9acddb', '#e7ad97', '#b7d8aa', '#c4b0dd', '#e3c58d', '#9fb5d8']

function normalizeTimeSeriesReport(report: TimeSeriesGenerationReport): TimeSeriesGenerationReport {
  return { ...report, candidates: report.candidates.map((candidate, index) => ({ ...candidate, id: `${candidate.id}-${index}` })) }
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Numeric({ value, min, max, step = 1, disabled, onChange }: { value: number; min?: number; max?: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(() => String(value))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [editing, value])

  return <input
    type="number"
    value={editing ? draft : String(value)}
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    onFocus={() => { setEditing(true); setDraft(String(value)) }}
    onChange={(event) => {
      const raw = event.target.value
      setDraft(raw)
      if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return
      const next = Number(raw)
      if (Number.isFinite(next)) onChange(next)
    }}
    onBlur={() => {
      setEditing(false)
      if (draft === '' || draft === '-' || draft === '.' || draft === '-.') setDraft(String(value))
    }}
  />
}

function OptionalNumeric({ value, min, max, step = 1, disabled, placeholder, onChange }: { value: number | null | undefined; min?: number; max?: number; step?: number; disabled?: boolean; placeholder?: string; onChange: (value: number | null) => void }) {
  return <input type="number" value={value ?? ''} min={min} max={max} step={step} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} />
}

function Section({ number, title, subtitle, children, variant = 'legacy' }: { number: number; title: string; subtitle: string; children: ReactNode; variant?: 'legacy' | 'timeSeries' }) {
  return <section className={`panel config-section ${variant === 'legacy' ? 'legacy-section' : 'time-series-section'}`}><header className="section-header"><span className="step">{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header>{children}</section>
}

function formatP(value: number) {
  if (value < 0.0001) return value.toExponential(3)
  return value.toFixed(5)
}

function methodLabel(method: GeneratorSettings['method'], design?: Candidate['test']['design']) {
  if (design === 'two-way') return 'Ordinary two-way ANOVA'
  if (method === 'student') return "Student's unpaired t-test"
  if (method === 'paired') return 'Paired t-test'
  if (method === 'anova') return 'One-way ANOVA'
  return "Welch's unpaired t-test"
}

function constraintPreset(constraint: { pMin: number; pMax: number }) {
  return pPresets.find((preset) => preset.min === constraint.pMin && preset.max === constraint.pMax)?.label ?? 'custom'
}

function presetRange(preset: (typeof pPresets)[number]) {
  if (preset.label === 'ns') return 'p≥0.05'
  if (preset.min === 0) return `p<${preset.max}`
  return `${preset.min}≤p<${preset.max}`
}

function constraintTarget(settings: GeneratorSettings) {
  const constraint = settings.pairwiseConstraints[0]
  return constraint && constraint.enabled !== false ? `${constraint.pMin}–${constraint.pMax}` : '未约束'
}

const pPresets = [
  { label: 'ns', min: 0.05, max: 1 },
  { label: '*', min: 0.01, max: 0.05 },
  { label: '**', min: 0.001, max: 0.01 },
  { label: '***', min: 0.0001, max: 0.001 },
  { label: '****', min: 0, max: 0.0001 },
]

function PairwiseConstraintPanel({ settings, onEdit }: { settings: GeneratorSettings; onEdit: (mutator: (draft: GeneratorSettings) => void) => void }) {
  const enabledConstraints = settings.pairwiseConstraints.filter((constraint) => constraint.enabled !== false)
  const groupName = (id: string) => settings.groups.find((group) => group.id === id)?.name ?? id
  return <>
    <details className="pair-selector">
      <summary>选择需要约束的组对 <strong>{enabledConstraints.length}/{settings.pairwiseConstraints.length}</strong></summary>
      <div className="pair-selector-menu">{settings.pairwiseConstraints.map((constraint) => <label key={constraint.id}><input type="checkbox" checked={constraint.enabled !== false} onChange={(event) => onEdit((draft) => { draft.pairwiseConstraints.find((item) => item.id === constraint.id)!.enabled = event.target.checked })} /><span>{groupName(constraint.leftGroupId)} vs {groupName(constraint.rightGroupId)}</span></label>)}</div>
    </details>
    <div className="pair-constraint-editor">{enabledConstraints.map((constraint) => <div className="pair-constraint-row" key={constraint.id}><strong>{groupName(constraint.leftGroupId)} vs {groupName(constraint.rightGroupId)}</strong><Field label="预设"><select value={constraintPreset(constraint)} onChange={(event) => onEdit((draft) => { const current = draft.pairwiseConstraints.find((item) => item.id === constraint.id); const preset = pPresets.find((item) => item.label === event.target.value); if (current && preset) { current.pMin = preset.min; current.pMax = preset.max } })}><option value="custom">自定义</option>{pPresets.map((preset) => <option key={preset.label} value={preset.label}>{preset.label}（{presetRange(preset)}）</option>)}</select></Field><Field label="p 最小"><Numeric value={constraint.pMin} min={0} max={1} step={0.001} onChange={(value) => onEdit((draft) => { draft.pairwiseConstraints.find((item) => item.id === constraint.id)!.pMin = value })} /></Field><span>&lt; p &lt;</span><Field label="p 最大"><Numeric value={constraint.pMax} min={0} max={1} step={0.001} onChange={(value) => onEdit((draft) => { draft.pairwiseConstraints.find((item) => item.id === constraint.id)!.pMax = value })} /></Field></div>)}</div>
    {enabledConstraints.length === 0 && <div className="no-pair-constraint">当前未选择组对：仅按统计设计、均值、范围、SD 和趋势生成。</div>}
  </>
}

function TwoWayEditor({ settings, onEdit }: { settings: GeneratorSettings; onEdit: (mutator: (draft: GeneratorSettings) => void) => void }) {
  const twoWay = settings.twoWay!
  const cellAt = (factorAIndex: number, factorBIndex: number) => twoWay.cells.find((cell) => cell.factorAIndex === factorAIndex && cell.factorBIndex === factorBIndex)!
  const editTwoWay = (mutator: (draft: TwoWaySettings) => void) => onEdit((draft) => { if (!draft.twoWay) return; mutator(draft.twoWay); syncTwoWayGroups(draft) })
  const addLevel = (factor: 'factorA' | 'factorB') => editTwoWay((draft) => { const index = draft[factor].levels.length + 1; draft[factor].levels.push(`${factor === 'factorA' ? '水平 A' : '水平 B'}${index}`) })
  const removeLevel = (factor: 'factorA' | 'factorB') => editTwoWay((draft) => { if (draft[factor].levels.length > 2) draft[factor].levels.pop() })
  const updateCell = (cellId: string, mutator: (cell: TwoWayCellConfig) => void) => editTwoWay((draft) => { const cell = draft.cells.find((item) => item.id === cellId); if (cell) mutator(cell) })
  const applyBatchTwoWay = () => onEdit((draft) => { if (!draft.twoWay) return; const n = draft.batchN ?? 8; const minimum = draft.batchMinValue ?? 0; const maximum = draft.batchMaxValue ?? null; const targetSd = draft.batchTargetSd ?? 1.2; draft.twoWay.cells.forEach((cell) => { cell.n = n; cell.minValue = minimum; cell.maxValue = maximum; cell.targetSd = targetSd }); syncTwoWayGroups(draft) })
  return <div className="two-way-editor">
    <div className="factor-config-grid">
      {(['factorA', 'factorB'] as const).map((factor) => <div className="factor-config" key={factor}><strong className="factor-title">{factor === 'factorA' ? '因素 A' : '因素 B'}</strong><div className="level-list">{twoWay[factor].levels.map((level, index) => <div className="level-row" key={`${factor}-${index}`}><input value={level} onChange={(event) => editTwoWay((draft) => { draft[factor].levels[index] = event.target.value })} /><button className="remove-level" disabled={twoWay[factor].levels.length <= 2} title="删除水平" onClick={() => editTwoWay((draft) => { if (draft[factor].levels.length > 2) draft[factor].levels.splice(index, 1) })}><X size={13} /></button></div>)}<div className="level-actions"><button className="add-level" onClick={() => addLevel(factor)}><Plus size={14} />添加水平</button><button className="remove-level-text" disabled={twoWay[factor].levels.length <= 2} onClick={() => removeLevel(factor)}>删除末个水平</button></div></div></div>)}
    </div>
    <div className="two-way-note">当前本地预览采用 ordinary two-way ANOVA；每个单元格的 n 需要保持一致。每格仍可单独设置目标均值、SD 和范围。</div>
    <div className="batch-range two-way-batch"><div><strong>批量设置</strong><small>应用后覆盖所有单元格；单元格仍可继续单独修改</small></div><Field label="批量 n"><Numeric value={settings.batchN ?? 8} min={2} max={50} onChange={(value) => onEdit((draft) => { draft.batchN = value })} /></Field><Field label="批量最小值"><Numeric value={settings.batchMinValue ?? 0} step={0.1} onChange={(value) => onEdit((draft) => { draft.batchMinValue = value })} /></Field><Field label="批量最大值"><OptionalNumeric value={settings.batchMaxValue} step={0.1} placeholder="不限制" onChange={(value) => onEdit((draft) => { draft.batchMaxValue = value })} /></Field><Field label="批量离散 SD"><Numeric value={settings.batchTargetSd ?? 1.2} min={0.01} step={1} onChange={(value) => onEdit((draft) => { draft.batchTargetSd = value })} /></Field><button className="button secondary batch-apply" onClick={applyBatchTwoWay}>应用到所有单元格</button></div>
    <div className="two-way-grid-wrap"><table className="two-way-grid"><thead><tr><th>{twoWay.factorB.name} \ {twoWay.factorA.name}</th>{twoWay.factorB.levels.map((level) => <th key={level}>{level}</th>)}</tr></thead><tbody>{twoWay.factorA.levels.map((level, factorAIndex) => <tr key={level}><th>{level}</th>{twoWay.factorB.levels.map((_, factorBIndex) => { const cell = cellAt(factorAIndex, factorBIndex); return <td key={cell.id}><div className="cell-config"><Field label="n"><Numeric value={cell.n} min={2} max={50} onChange={(value) => updateCell(cell.id, (item) => { item.n = value })} /></Field><Field label="均值"><Numeric value={cell.targetMean} step={1} onChange={(value) => updateCell(cell.id, (item) => { item.targetMean = value })} /></Field><Field label="SD"><Numeric value={cell.targetSd} min={0.01} step={1} onChange={(value) => updateCell(cell.id, (item) => { item.targetSd = value })} /></Field><div className="cell-range"><Field label="最小"><Numeric value={cell.minValue} step={0.1} onChange={(value) => updateCell(cell.id, (item) => { item.minValue = value })} /></Field><Field label="最大"><OptionalNumeric value={cell.maxValue} step={0.1} placeholder="不限制" onChange={(value) => updateCell(cell.id, (item) => { item.maxValue = value })} /></Field></div></div></td> })}</tr>)}</tbody></table></div>
  </div>
}

function TwoWayRawTable({ candidate, settings }: { candidate: Candidate; settings: GeneratorSettings }) {
  const twoWay = settings.twoWay!
  const cellAt = (factorAIndex: number, factorBIndex: number) => twoWay.cells.find((cell) => cell.factorAIndex === factorAIndex && cell.factorBIndex === factorBIndex)!
  const replicates = twoWay.cells[0]?.n ?? 0
  return <table className="two-way-raw-table"><thead><tr><th rowSpan={2}>{twoWay.factorB.name}</th>{twoWay.factorA.levels.map((level) => <th key={level} colSpan={replicates}>{level}</th>)}</tr><tr>{twoWay.factorA.levels.flatMap((_, factorAIndex) => Array.from({ length: replicates }, (_, replicate) => <th key={`${factorAIndex}-${replicate}`}>{String.fromCharCode(65 + factorAIndex)}:{replicate + 1}</th>))}</tr></thead><tbody>{twoWay.factorB.levels.map((level, factorBIndex) => <tr key={level}><th>{level}</th>{twoWay.factorA.levels.flatMap((_, factorAIndex) => { const cell = cellAt(factorAIndex, factorBIndex); const cellIndex = twoWay.cells.findIndex((item) => item.id === cell.id); return (candidate.values[cellIndex] ?? []).map((value, index) => <td key={`${cell.id}-${index}`}>{value}</td>) })}</tr>)}</tbody></table>
}

function timeSeriesCellAt(settings: TimeSeriesGeneratorSettings, groupIndex: number, timeIndex: number) {
  return settings.cells.find((cell) => cell.groupIndex === groupIndex && cell.timeIndex === timeIndex)
}

function TimeSeriesEditor({ settings, onEdit, onModeChange, onGenerate, generating }: { settings: TimeSeriesGeneratorSettings; onEdit: (mutator: (draft: TimeSeriesGeneratorSettings) => void) => void; onModeChange: (mode: 'single' | 'twoWay' | 'timeSeries') => void; onGenerate: () => void; generating: boolean }) {
  const edit = (mutator: (draft: TimeSeriesGeneratorSettings) => void) => onEdit((draft) => { mutator(draft); syncTimeSeriesCells(draft) })
  const addGroup = () => edit((draft) => {
    const index = draft.groups.length
    const previous = draft.groups[index - 1]
    draft.groups.push({ id: `ts-group-${Date.now()}-${index}`, name: `Group ${index + 1}`, n: previous?.n ?? 8, color: colors[index % colors.length] })
  })
  const removeGroup = () => edit((draft) => { if (draft.groups.length > 2) draft.groups.pop() })
  const addTimePoint = () => edit((draft) => {
    const index = draft.timePoints.length
    const previous = draft.timePoints[index - 1]
    const value = (previous?.value ?? index - 1) + 1
    draft.timePoints.push({ id: `ts-time-${Date.now()}-${index}`, value, label: `Day ${value}` })
  })
  const removeTimePoint = () => edit((draft) => { if (draft.timePoints.length > 2) draft.timePoints.pop() })
  const updateGroup = (groupId: string, mutator: (group: TimeSeriesGroupConfig) => void) => edit((draft) => {
    const group = draft.groups.find((item) => item.id === groupId)
    if (group) mutator(group)
  })
  const updateTimePoint = (timeId: string, mutator: (time: TimePointConfig) => void) => edit((draft) => {
    const time = draft.timePoints.find((item) => item.id === timeId)
    if (time) mutator(time)
  })
  const updateCell = (groupIndex: number, timeIndex: number, mutator: (cell: TimeSeriesCellConfig) => void) => edit((draft) => {
    const cell = timeSeriesCellAt(draft, groupIndex, timeIndex)
    if (cell) mutator(cell)
  })
  const applyN = (value: number) => edit((draft) => { draft.groups.forEach((group) => { group.n = value }) })
  const applyBatchSettings = () => edit((draft) => {
    const targetMean = draft.batchTargetMean ?? 10
    const minimum = draft.batchMinValue ?? 0
    const maximum = draft.batchMaxValue ?? null
    const targetSd = draft.batchTargetSd ?? 1.2
    draft.cells.forEach((cell) => {
      cell.targetMean = targetMean
      cell.minValue = minimum
      cell.maxValue = maximum
      cell.targetSd = targetSd
    })
  })
  return <div className="time-series-editor">
    <div className="time-series-note">同一批动物连续测量：每组 n 相同，每只动物在每个时间点均有数据。模型固定为重复测量 two-way ANOVA。</div>
    <div className="ts-data-grid">
      <Field label="统计模式"><select value="timeSeries" onChange={(event) => onModeChange(event.target.value as 'single' | 'twoWay' | 'timeSeries')}><option value="timeSeries">重复测量时间序列</option><option value="twoWay">Two-way ANOVA</option><option value="single">单因素 / t-test</option></select></Field>
      <Field label="数据类型"><select value={settings.dataType} onChange={(event) => onEdit((draft) => { draft.dataType = event.target.value as TimeSeriesGeneratorSettings['dataType']; if (draft.dataType === 'integer') draft.decimals = 0 })}><option value="decimal">小数</option><option value="integer">整数</option></select></Field>
      <Field label="小数位数"><div className="decimal-setting"><Numeric value={settings.decimals ?? 2} min={0} max={12} disabled={settings.dataType === 'integer' || settings.decimals === null} onChange={(value) => onEdit((draft) => { draft.decimals = value })} /><button type="button" className={settings.decimals === null ? 'active' : ''} disabled={settings.dataType === 'integer'} onClick={() => onEdit((draft) => { draft.decimals = draft.decimals === null ? 2 : null })}>{settings.decimals === null ? '不限制 ✓' : '不做要求'}</button></div></Field>
      <Field label="分布形态"><select value={settings.distribution} onChange={(event) => onEdit((draft) => { draft.distribution = event.target.value as TimeSeriesGeneratorSettings['distribution'] })}><option value="normal">正态分布</option><option value="lognormal">对数正态</option><option value="irregular">轻度不规则</option></select></Field>
      <Field label="不规则程度"><Numeric value={settings.irregularity} min={0} max={1} step={0.05} disabled={settings.distribution !== 'irregular'} onChange={(value) => onEdit((draft) => { draft.irregularity = value })} /></Field>
    </div>
    <div className="ts-builder-grid">
      <div className="ts-list-panel"><div className="ts-panel-heading"><strong>实验组</strong><button className="add-level" onClick={addGroup}><Plus size={14} />添加组</button></div><div className="ts-group-list">{settings.groups.map((group, index) => <div className="ts-group-row" key={group.id}><span className="group-mark" style={{ background: group.color }}>{String.fromCharCode(65 + index)}</span><input value={group.name} onChange={(event) => updateGroup(group.id, (item) => { item.name = event.target.value })} /><Field label="n"><Numeric value={group.n} min={2} max={50} onChange={(value) => updateGroup(group.id, (item) => { item.n = value })} /></Field>{settings.groups.length > 2 && <button className="remove-level" title="删除末组" onClick={removeGroup}><X size={13} /></button>}</div>)}</div><div className="ts-batch-row"><Field label="统一设置 n"><Numeric value={settings.groups[0]?.n ?? 8} min={2} max={50} onChange={applyN} /></Field><small>所有组必须使用相同 n</small></div></div>
      <div className="ts-list-panel"><div className="ts-panel-heading"><strong>时间点</strong><button className="add-level" onClick={addTimePoint}><Plus size={14} />添加时间点</button></div><div className="ts-time-list">{settings.timePoints.map((time, index) => <div className="ts-time-row" key={time.id}><span className="time-index">{index + 1}</span><Field label="数值"><Numeric value={time.value} step={0.1} onChange={(value) => updateTimePoint(time.id, (item) => { item.value = value })} /></Field><Field label="显示标签"><input value={time.label} onChange={(event) => updateTimePoint(time.id, (item) => { item.label = event.target.value })} /></Field>{settings.timePoints.length > 2 && <button className="remove-level" title="删除末时间点" onClick={removeTimePoint}><X size={13} /></button>}</div>)}</div><small className="ts-help">数值控制 X 轴实际间距，标签用于显示。</small></div>
    </div>
    <div className="batch-range ts-batch-range"><div><strong>批量设置</strong><small>应用后覆盖所有组 × 时间点；单元格仍可继续单独修改</small></div><Field label="批量均值"><Numeric value={settings.batchTargetMean ?? 10} step={1} onChange={(value) => onEdit((draft) => { draft.batchTargetMean = value })} /></Field><Field label="批量最小值"><Numeric value={settings.batchMinValue ?? 0} step={0.1} onChange={(value) => onEdit((draft) => { draft.batchMinValue = value })} /></Field><Field label="批量最大值"><OptionalNumeric value={settings.batchMaxValue} step={0.1} placeholder="不限制" onChange={(value) => onEdit((draft) => { draft.batchMaxValue = value })} /></Field><Field label="批量离散 SD"><Numeric value={settings.batchTargetSd ?? 1.2} min={0.01} step={1} onChange={(value) => onEdit((draft) => { draft.batchTargetSd = value })} /></Field><button className="button secondary batch-apply" onClick={applyBatchSettings}>应用到所有单元格</button></div>
    <div className="ts-cell-grid-wrap"><table className="ts-cell-grid"><thead><tr><th>组 \ 时间</th>{settings.timePoints.map((time) => <th key={time.id}>{time.label}<small>({time.value})</small></th>)}</tr></thead><tbody>{settings.groups.map((group, groupIndex) => <tr key={group.id}><th><span className="group-mark" style={{ background: group.color }}>{String.fromCharCode(65 + groupIndex)}</span>{group.name}</th>{settings.timePoints.map((time, timeIndex) => { const cell = timeSeriesCellAt(settings, groupIndex, timeIndex)!; return <td key={cell.id}><div className="ts-cell-config"><Field label="均值"><Numeric value={cell.targetMean} step={1} onChange={(value) => updateCell(groupIndex, timeIndex, (item) => { item.targetMean = value })} /></Field><Field label="SD"><Numeric value={cell.targetSd} min={0.01} step={1} onChange={(value) => updateCell(groupIndex, timeIndex, (item) => { item.targetSd = value })} /></Field><div className="cell-range"><Field label="最小"><Numeric value={cell.minValue} step={0.1} onChange={(value) => updateCell(groupIndex, timeIndex, (item) => { item.minValue = value })} /></Field><Field label="最大"><OptionalNumeric value={cell.maxValue} step={0.1} placeholder="不限制" onChange={(value) => updateCell(groupIndex, timeIndex, (item) => { item.maxValue = value })} /></Field></div></div></td> })}</tr>)}</tbody></table></div>
    <div className="ts-chart-settings"><Field label="图表标题"><input value={settings.chartTitle} onChange={(event) => onEdit((draft) => { draft.chartTitle = event.target.value })} /></Field><Field label="X 轴标题"><input value={settings.xAxisTitle} onChange={(event) => onEdit((draft) => { draft.xAxisTitle = event.target.value })} /></Field><Field label="Y 轴标题"><input value={settings.yAxisTitle} onChange={(event) => onEdit((draft) => { draft.yAxisTitle = event.target.value })} /></Field><Field label="误差线"><select value={settings.errorBar} onChange={(event) => onEdit((draft) => { draft.errorBar = event.target.value as TimeSeriesGeneratorSettings['errorBar'] })}><option value="sd">SD</option><option value="sem">SEM</option><option value="ci">95% CI</option></select></Field></div>
    <div className="ts-seed-row"><button className={`lock-toggle ${settings.seedMode === 'locked' ? 'locked' : ''}`} onClick={() => onEdit((draft) => { draft.seedMode = draft.seedMode === 'locked' ? 'random' : 'locked' })}>{settings.seedMode === 'locked' ? <Lock size={16} /> : <Unlock size={16} />}{settings.seedMode === 'locked' ? '已锁定 seed' : '每次全新随机'}</button><Field label="复现 seed"><input disabled={settings.seedMode === 'random'} value={settings.seed} onChange={(event) => onEdit((draft) => { draft.seed = event.target.value })} /></Field><Field label="候选数"><Numeric value={3} min={1} max={3} disabled onChange={() => undefined} /></Field><button className="button primary generate-large" onClick={onGenerate} disabled={generating}>{generating ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}{generating ? '正在生成' : '生成 3 套候选'}</button></div>
  </div>
}

function TimeSeriesRawTable({ candidate, settings }: { candidate: TimeSeriesCandidate; settings: TimeSeriesGeneratorSettings }) {
  const subjects = settings.groups[0]?.n ?? 0
  return <table className="two-way-raw-table ts-raw-table"><thead><tr><th rowSpan={2}>时间</th>{settings.groups.map((group) => <th key={group.id} colSpan={subjects}>{group.name}</th>)}</tr><tr>{settings.groups.flatMap((group, groupIndex) => Array.from({ length: subjects }, (_, index) => <th key={`${group.id}-${index}`}>{String.fromCharCode(65 + groupIndex)}:{index + 1}</th>))}</tr></thead><tbody>{settings.timePoints.map((time, timeIndex) => <tr key={time.id}><th>{time.label}</th>{settings.groups.flatMap((group, groupIndex) => (candidate.values[groupIndex]?.[timeIndex] ?? []).map((value, index) => <td key={`${group.id}-${time.id}-${index}`}>{value}</td>))}</tr>)}</tbody></table>
}

function TimeSeriesSummaryTable({ candidate, settings }: { candidate: TimeSeriesCandidate; settings: TimeSeriesGeneratorSettings }) {
  const summaryAt = (groupIndex: number, timeIndex: number) => candidate.summaries.find((summary) => summary.groupId === settings.groups[groupIndex]?.id && summary.timeId === settings.timePoints[timeIndex]?.id)
  return <section className="stat-card ts-summary-card"><header><div><h3>统计汇总表</h3><p>每个时间点显示均值、SD 和样本量</p></div></header><div className="raw-table"><table className="ts-summary-table"><thead><tr><th>时间</th>{settings.groups.map((group) => <th key={group.id}>{group.name}</th>)}</tr></thead><tbody>{settings.timePoints.map((time, timeIndex) => <tr key={time.id}><th>{time.label}</th>{settings.groups.map((group, groupIndex) => { const summary = summaryAt(groupIndex, timeIndex); return <td key={group.id}>{summary ? <><strong>{summary.mean.toFixed(3)}</strong><small>SD {summary.sd.toFixed(3)} · n={summary.n}</small></> : '-'}</td> })}</tr>)}</tbody></table></div></section>
}

function TimeSeriesResultColumn({ report, selected, selectedIndex, setSelectedIndex, chartRef, errorType, setErrorType, onCopy, onExportCsv, resultStatus }: { resultStatus: ReactNode; report: TimeSeriesGenerationReport; selected: TimeSeriesCandidate; selectedIndex: number; setSelectedIndex: (index: number) => void; chartRef: React.RefObject<ReactECharts | null>; errorType: 'sd' | 'sem' | 'ci'; setErrorType: (type: 'sd' | 'sem' | 'ci') => void; onCopy: () => void; onExportCsv: () => void }) {
  const settings = report.settings
  const effects = [settings.groups.length, settings.timePoints.length]
  const pairwise = selected.test.pairwise ?? []
  return <aside className="result-column panel">{resultStatus}<header className="result-header"><div><span className="step">6</span><div><h2>时间序列结果预览</h2><p>{report.message}</p></div></div><span className="status pass">READY</span></header><div className="candidate-tabs">{report.candidates.map((candidate, index) => <button className={selectedIndex === index ? 'active' : ''} onClick={() => setSelectedIndex(index)} key={candidate.id}><span>方案 {String.fromCharCode(65 + index)}</span><strong>交互 p={formatP(candidate.test.twoWay.interaction.pValue)}</strong><small>重复测量 two-way ANOVA</small></button>)}</div><div className="result-toolbar"><div className="segmented"><button className={errorType === 'sd' ? 'active' : ''} onClick={() => setErrorType('sd')}>SD</button><button className={errorType === 'sem' ? 'active' : ''} onClick={() => setErrorType('sem')}>SEM</button><button className={errorType === 'ci' ? 'active' : ''} onClick={() => setErrorType('ci')}>95% CI</button></div><span className="ts-result-meta">{effects[0]} 组 × {effects[1]} 时间点</span></div><div className="chart"><ResultChart ref={chartRef} candidate={selected} settings={settings} errorType={errorType} /></div><section className="stat-card"><header><div><h3>重复测量 ANOVA</h3><p>同一批动物 · 组别 × 时间</p></div><span className="seed-display">seed {selected.seed.slice(0, 18)}…</span></header><div className="ts-anova-results">{[selected.test.twoWay.group, selected.test.twoWay.time, selected.test.twoWay.interaction].map((effect) => <div key={effect.name}><strong>{effect.name}</strong><span>F({effect.degreesOfFreedom},{selected.test.twoWay.residualDegreesOfFreedom})={effect.statistic.toFixed(3)}</span><b>p={formatP(effect.pValue)}</b></div>)}</div></section><section className="pairwise-card"><header><div><h3>各时间点组间比较</h3><p>Welch pairwise + Holm 校正</p></div></header><div className="pairwise-list">{pairwise.map((pair) => <div className="pairwise-row" key={`${pair.timeIndex}-${pair.leftGroupId}-${pair.rightGroupId}`}><span>{pair.timeLabel} · {pair.leftGroupName} vs {pair.rightGroupName}</span><strong>{pair.label}</strong><small>p={formatP(pair.pValue)}</small></div>)}</div></section><TimeSeriesSummaryTable candidate={selected} settings={settings} /><section className="raw-card"><header><div><h3>Grouped 原始数据</h3><p>时间 × 组 × 动物；可复制到 Prism 或 Excel</p></div><div><button className="icon-text" onClick={onCopy}><Copy size={14} />复制分组表</button><button className="icon-text" onClick={onExportCsv}><Download size={14} />CSV</button></div></header><div className="raw-table"><TimeSeriesRawTable candidate={selected} settings={settings} /></div></section></aside>
}

function nextGroup(settings: GeneratorSettings): GroupConfig {
  const index = settings.groups.length
  const previous = settings.groups[index - 1]
  return { id: `group-${Date.now()}-${index}`, name: `Group ${index + 1}`, n: 8, meanOffset: index * 1.5, targetMean: (previous?.targetMean ?? 10) + 1.5, minValue: previous?.minValue ?? 0, maxValue: previous?.maxValue ?? null, targetSd: previous?.targetSd ?? 1.2, color: colors[index % colors.length] }
}

export default function App({ onLogout, navigation }: { onLogout?: () => void; navigation?: ReactNode } = {}) {
  const [settings, setSettings] = useState<GeneratorSettings>(() => cloneSettings(defaultSettings))
  const [report, setReport] = useState<GenerationReport>(() => generateCandidates(cloneSettings(defaultSettings)))
  const [timeSeriesSettings, setTimeSeriesSettings] = useState<TimeSeriesGeneratorSettings>(() => JSON.parse(JSON.stringify(defaultTimeSeriesSettings)) as TimeSeriesGeneratorSettings)
  const [timeSeriesReport, setTimeSeriesReport] = useState<TimeSeriesGenerationReport>(() => normalizeTimeSeriesReport(generateTimeSeriesCandidates(JSON.parse(JSON.stringify(defaultTimeSeriesSettings)) as TimeSeriesGeneratorSettings)))
  const [analysisMode, setAnalysisMode] = useState<'single' | 'twoWay' | 'timeSeries'>(() => 'single')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [timeSeriesSelectedIndex, setTimeSeriesSelectedIndex] = useState(0)
  // Compare with submitted inputs, not the seed/constraints normalized by the generator.
  const [resultInput, setResultInput] = useState<string | null>(() => JSON.stringify(defaultSettings))
  const [timeSeriesResultInput, setTimeSeriesResultInput] = useState<string | null>(() => JSON.stringify(defaultTimeSeriesSettings))
  const [generating, setGenerating] = useState(false)
  const [errorType, setErrorType] = useState<'sd' | 'sem' | 'ci'>('sd')
  const [notice, setNotice] = useState('')
  const chartRef = useRef<ReactECharts>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const selected = report.candidates[selectedIndex] ?? report.candidates[0]
  const isMultiGroup = settings.groups.length >= 3
  const isTimeSeries = analysisMode === 'timeSeries'
  const isTwoWay = !isTimeSeries && settings.analysisDesign === 'twoWay'
  const resultIsTwoWay = report.settings.analysisDesign === 'twoWay'
  const activeResultInput = isTimeSeries ? timeSeriesResultInput : resultInput
  const dirty = JSON.stringify(isTimeSeries ? timeSeriesSettings : settings) !== activeResultInput
  const resultStatus = <div className={`result-state ${dirty || (generating && !isTimeSeries) ? 'pending' : ''}`} role="status">
    <strong>{generating && !isTimeSeries ? '正在生成，当前仍显示上次结果' : activeResultInput === null ? '已载入结果，请重新生成以确认参数一致' : dirty ? '参数已修改，当前显示上次结果' : '结果已更新'}</strong>
    <small>{dirty || (generating && !isTimeSeries) ? '复制和导出仍使用当前显示的结果；重新生成后更新。' : '当前预览、复制和导出对应同一次生成；约束是否满足请查看下方验证。'}</small>
  </div>
  const selectedTimeSeries = timeSeriesReport.candidates[timeSeriesSelectedIndex] ?? timeSeriesReport.candidates[0]

  const edit = (mutator: (draft: GeneratorSettings) => void) => {
    setSettings((current) => {
      const draft = cloneSettings(current)
      mutator(draft)
      return draft
    })
  }

  const editTimeSeries = (mutator: (draft: TimeSeriesGeneratorSettings) => void) => {
    setTimeSeriesSettings((current) => {
      const draft = JSON.parse(JSON.stringify(current)) as TimeSeriesGeneratorSettings
      mutator(draft)
      return draft
    })
  }

  const addGroup = () => edit((draft) => {
    draft.groups.push(nextGroup(draft))
    draft.pairwiseConstraints = ensurePairwiseConstraints(draft)
    if (draft.groups.length >= 3) draft.method = 'anova'
  })

  const setAnalysisDesign = (design: GeneratorSettings['analysisDesign']) => edit((draft) => {
    draft.analysisDesign = design ?? 'single'
    if (draft.analysisDesign === 'twoWay') {
      if (!draft.twoWay) draft.twoWay = cloneSettings(defaultSettings).twoWay
      syncTwoWayGroups(draft)
    }
  })

  const switchAnalysisMode = (mode: 'single' | 'twoWay' | 'timeSeries') => {
    if (mode === 'timeSeries') {
      setAnalysisMode('timeSeries')
      return
    }
    setAnalysisMode(mode)
    setAnalysisDesign(mode === 'twoWay' ? 'twoWay' : 'single')
  }

  const removeGroup = (id: string) => edit((draft) => {
    if (draft.groups.length <= 2) return
    draft.groups = draft.groups.filter((group) => group.id !== id)
    draft.pairwiseConstraints = ensurePairwiseConstraints(draft)
    if (draft.groups.length === 2 && draft.method === 'anova') draft.method = 'welch'
  })

  const updateGroup = (id: string, mutator: (group: GroupConfig) => void) => edit((draft) => {
    const group = draft.groups.find((item) => item.id === id)
    if (group) mutator(group)
  })

  const applyBatchSettings = () => edit((draft) => {
    const n = draft.batchN ?? 8
    const minimum = draft.batchMinValue ?? 0
    const maximum = draft.batchMaxValue ?? null
    const targetSd = draft.batchTargetSd ?? 1.2
    draft.groups.forEach((group) => { group.n = n; group.minValue = minimum; group.maxValue = maximum; group.targetSd = targetSd })
  })

  const resetForm = () => {
    if (!window.confirm('清空当前设置并恢复初始模板？')) return
    const freshSettings = cloneSettings(defaultSettings)
    setSettings(freshSettings)
    setReport(generateCandidates(cloneSettings(freshSettings)))
    const freshTimeSeries = JSON.parse(JSON.stringify(defaultTimeSeriesSettings)) as TimeSeriesGeneratorSettings
    setTimeSeriesSettings(freshTimeSeries)
    setTimeSeriesReport(normalizeTimeSeriesReport(generateTimeSeriesCandidates(JSON.parse(JSON.stringify(freshTimeSeries)))))
    setAnalysisMode('single')
    setSelectedIndex(0)
    setTimeSeriesSelectedIndex(0)
    setResultInput(JSON.stringify(freshSettings))
    setTimeSeriesResultInput(JSON.stringify(freshTimeSeries))
    setErrorType('sd')
    setNotice('已清空当前设置，可以重新填写')
  }

  const generate = () => {
    if (generating) return
    if (isTimeSeries) {
      setGenerating(true)
      setNotice('')
      try {
        const nextReport = generateTimeSeriesCandidates(JSON.parse(JSON.stringify(timeSeriesSettings)) as TimeSeriesGeneratorSettings)
        setTimeSeriesReport(normalizeTimeSeriesReport(nextReport))
        setTimeSeriesSelectedIndex(0)
        setTimeSeriesResultInput(JSON.stringify(timeSeriesSettings))
        setNotice(nextReport.message)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '时间序列生成失败')
      }
      setGenerating(false)
      return
    }
    setGenerating(true)
    setNotice('')
    const submittedSettings = cloneSettings(settings)
    const submittedInput = JSON.stringify(submittedSettings)
    const worker = new Worker(new URL('./workers/generator.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ ok: boolean; report?: GenerationReport; error?: string }>) => {
      if (event.data.ok && event.data.report) {
        setReport(event.data.report)
        setSelectedIndex(0)
        setResultInput(submittedInput)
        setNotice(event.data.report.message)
      } else setNotice(event.data.error ?? '生成失败')
      setGenerating(false)
      worker.terminate()
    }
    worker.onerror = () => { setNotice('随机搜索线程运行失败'); setGenerating(false); worker.terminate() }
    worker.postMessage(submittedSettings)
  }

  const loadProject = async (file: File) => {
    try {
      const payload = JSON.parse(await file.text()) as { schemaVersion?: number; design?: string; settings?: GeneratorSettings | TimeSeriesGeneratorSettings; report?: GenerationReport | TimeSeriesGenerationReport | null }
      if (payload.schemaVersion !== 1 || !payload.settings) throw new Error('不是受支持的 Synthetic Data Studio 项目文件')
      const hasSavedCandidates = Boolean(payload.report && 'candidates' in payload.report && payload.report.candidates.length)
      if (payload.design === 'repeated-measures-time-series' || 'design' in payload.settings) {
        const nextSettings = payload.settings as TimeSeriesGeneratorSettings
        const nextReport = hasSavedCandidates ? payload.report as TimeSeriesGenerationReport : generateTimeSeriesCandidates(nextSettings)
        setTimeSeriesSettings(nextSettings)
        setTimeSeriesReport(nextReport)
        setTimeSeriesResultInput(hasSavedCandidates ? null : JSON.stringify(nextSettings))
        setAnalysisMode('timeSeries')
        setTimeSeriesSelectedIndex(0)
      } else {
        const nextSettings = payload.settings as GeneratorSettings
        const nextReport = hasSavedCandidates ? payload.report as GenerationReport : generateCandidates(nextSettings)
        setSettings(nextSettings)
        setReport(nextReport)
        setResultInput(hasSavedCandidates ? null : JSON.stringify(nextSettings))
        setAnalysisMode(nextSettings.analysisDesign === 'twoWay' ? 'twoWay' : 'single')
        setSelectedIndex(0)
      }
      setNotice('项目已打开')
    } catch (error) { setNotice(error instanceof Error ? error.message : '项目读取失败') }
  }

  const copyData = async () => {
    if (!selected) return
    await copyPrismColumns(selected, report.settings)
    setNotice('已复制为列式数据')
  }

  const copyGroupedData = async () => {
    if (!selected || !resultIsTwoWay) return
    await copyPrismGrouped(selected, report.settings)
    setNotice('已复制为 Prism 分组表')
  }

  const copyTimeSeriesData = async () => {
    if (!selectedTimeSeries) return
    const resultSettings = timeSeriesReport.settings
    const subjects = resultSettings.groups[0]?.n ?? 0
    const rows = [
      ['时间', ...resultSettings.groups.flatMap((group) => Array.from({ length: subjects }, () => group.name))],
      ['', ...resultSettings.groups.flatMap((group, groupIndex) => Array.from({ length: subjects }, (_, index) => `${String.fromCharCode(65 + groupIndex)}:${index + 1}`))],
      ...resultSettings.timePoints.map((time, timeIndex) => [time.label, ...resultSettings.groups.flatMap((group, groupIndex) => selectedTimeSeries.values[groupIndex]?.[timeIndex] ?? [])]),
    ]
    await navigator.clipboard.writeText(rows.map((row) => row.join('\t')).join('\n'))
    setNotice('已复制时间序列分组表')
  }

  const exportTimeSeriesRawCsv = () => {
    if (!selectedTimeSeries) return
    exportTimeSeriesCsv(selectedTimeSeries, timeSeriesReport.settings)
    setNotice('已导出时间序列分组 CSV')
  }

  const exportPng = () => {
    const url = chartRef.current?.getEchartsInstance().getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    if (!url) return
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${isTimeSeries ? timeSeriesReport.settings.chartTitle : report.settings.projectName}_plot.png`
    anchor.click()
  }

  return <main className="app">
    <header className="topbar panel"><div className="brand"><span className="eyebrow">RESEARCH DATA WORKBENCH</span><h1>生成可分析科研数据工作台</h1><p>目标统计约束下的本地随机数据工作台</p></div><div className="top-actions">
      <input ref={fileInput} hidden type="file" accept=".json,.synthetic.json" onChange={(event) => event.target.files?.[0] && loadProject(event.target.files[0])} />
       <button className="button reset" onClick={resetForm} disabled={generating}><RotateCcw size={17} />清空重填</button><button className="button secondary" onClick={() => fileInput.current?.click()} disabled={generating}><FolderOpen size={17} />打开</button><button className="button secondary" onClick={() => isTimeSeries ? saveTimeSeriesProject(timeSeriesSettings, timeSeriesReport) : saveProject(settings, report)}><Save size={17} />保存</button><button className="button primary" onClick={generate} disabled={generating}>{generating ? <RefreshCw className="spin" size={17} /> : <Sparkles size={17} />}{generating ? '搜索中' : '生成方案'}</button><button className="button warm" onClick={() => isTimeSeries ? selectedTimeSeries && exportTimeSeriesXlsx(timeSeriesReport, selectedTimeSeries) : selected && exportXlsx(report, selected)}><FileDown size={17} />导出 XLSX</button><button className="button secondary" onClick={() => isTimeSeries ? exportTimeSeriesZip(timeSeriesReport) : exportZip(report)}><FileArchive size={17} />候选 ZIP</button>{onLogout && <button className="button secondary" onClick={onLogout}><LogOut size={17} />退出登录</button>}
    </div></header>
    {navigation}
    <nav className="tabs">{!navigation && <button className="active"><BarChart3 size={16} />数据反推生成</button>}<div className="mode-switch" role="tablist" aria-label="分析模式"><button className={analysisMode === 'single' ? 'active' : ''} onClick={() => switchAnalysisMode('single')}>单因素 / t-test</button><button className={analysisMode === 'twoWay' ? 'active' : ''} onClick={() => switchAnalysisMode('twoWay')}>Two-way ANOVA</button><button className={analysisMode === 'timeSeries' ? 'active' : ''} onClick={() => switchAnalysisMode('timeSeries')}>重复测量时间序列</button></div><span className="independent-badge">浏览器本地计算</span>{dirty && <span className="dirty">参数已修改，请重新生成</span>}</nav>
    <div className="warning-banner"><AlertTriangle size={16} /><strong>SIMULATED / 合成模拟数据</strong><span>仅用于教学、绘图、统计方法验证和软件测试，不代表真实实验观测。</span></div>

    <div className="workspace"><div className={`config-column ${isTimeSeries ? 'time-series-mode' : ''}`}>
      {isTimeSeries && <>
        <Section number={1} title="时间序列数据设置" subtitle="设置同一批动物在多个自定义时间点的重复测量数据" variant="timeSeries"><TimeSeriesEditor settings={timeSeriesSettings} onEdit={editTimeSeries} onModeChange={switchAnalysisMode} onGenerate={generate} generating={generating} /></Section>
      </>}
      {!isTimeSeries && <>
      <Section number={1} title="数据设置" subtitle="选择数值类型、保留位数和分布形态；离散大小在每组的目标 SD 中设置"><div className="grid three"><Field label="数据类型"><select value={settings.dataType} onChange={(event) => edit((draft) => { draft.dataType = event.target.value as GeneratorSettings['dataType']; if (draft.dataType === 'integer') draft.decimals = 0 })}><option value="decimal">小数</option><option value="integer">整数</option></select></Field><Field label="小数位数"><div className="decimal-setting"><Numeric value={settings.decimals ?? 2} min={0} max={12} disabled={settings.dataType === 'integer' || settings.decimals === null} onChange={(value) => edit((draft) => { draft.decimals = value })} /><button type="button" className={settings.decimals === null ? 'active' : ''} disabled={settings.dataType === 'integer'} onClick={() => edit((draft) => { draft.decimals = draft.decimals === null ? 2 : null })}>{settings.decimals === null ? '不限制 ✓' : '不做要求'}</button></div></Field><Field label="分布形态"><select value={settings.distribution} onChange={(event) => edit((draft) => { draft.distribution = event.target.value as GeneratorSettings['distribution'] })}><option value="normal">正态分布</option><option value="lognormal">对数正态（log 原始值后近似正态）</option><option value="irregular">轻度不规则（轻微偏态）</option></select></Field><Field label="不规则程度"><Numeric value={settings.irregularity} min={0} max={1} step={0.05} disabled={settings.distribution !== 'irregular'} onChange={(value) => edit((draft) => { draft.irregularity = value })} /></Field><Field label="最大尝试次数"><Numeric value={settings.maxAttempts} min={1000} max={500000} step={1000} onChange={(value) => edit((draft) => { draft.maxAttempts = value })} /></Field></div></Section>

      <Section number={2} title="统计设计" subtitle={isTwoWay ? '可增删两个因素的水平；数据按 m × k 单元格生成并计算主效应与交互作用' : '两组使用 t-test；三组及以上自动切换为 one-way ANOVA'}>
        <div className="grid three"><Field label="统计方法"><select value={isTwoWay ? 'twoWay' : (settings.method === 'anova' ? 'oneWay' : settings.method)} onChange={(event) => event.target.value === 'timeSeries' ? switchAnalysisMode('timeSeries') : event.target.value === 'twoWay' ? switchAnalysisMode('twoWay') : edit((draft) => { setAnalysisMode('single'); draft.analysisDesign = 'single'; draft.method = event.target.value === 'oneWay' ? 'anova' : event.target.value as GeneratorSettings['method'] })}><option value="welch">Welch t-test</option><option value="student">Student t-test</option><option value="paired">Paired t-test</option><option value="oneWay">One-way ANOVA</option><option value="twoWay">Two-way ANOVA</option><option value="timeSeries">重复测量时间序列</option></select></Field><Field label="检验侧数"><select disabled={isMultiGroup || isTwoWay} value={settings.tail} onChange={(event) => edit((draft) => { draft.tail = event.target.value as GeneratorSettings['tail'] })}><option value="two-sided">双侧</option><option value="greater">单侧：第二组更高</option><option value="less">单侧：第二组更低</option></select></Field><Field label="项目名称"><input value={settings.projectName} onChange={(event) => edit((draft) => { draft.projectName = event.target.value })} /></Field></div>
 {isTwoWay ? <TwoWayEditor settings={settings} onEdit={edit} /> : <><div className="batch-range"><div><strong>批量设置</strong><small>应用后覆盖所有组；单组仍可继续单独修改</small></div><Field label="批量 n"><Numeric value={settings.batchN ?? 8} min={2} max={50} onChange={(value) => edit((draft) => { draft.batchN = value })} /></Field><Field label="批量最小值"><Numeric value={settings.batchMinValue ?? 0} step={0.1} onChange={(value) => edit((draft) => { draft.batchMinValue = value })} /></Field><Field label="批量最大值"><OptionalNumeric value={settings.batchMaxValue} step={0.1} placeholder="不限制" onChange={(value) => edit((draft) => { draft.batchMaxValue = value })} /></Field><Field label="批量离散 SD"><Numeric value={settings.batchTargetSd ?? 1.2} min={0.01} step={1} onChange={(value) => edit((draft) => { draft.batchTargetSd = value })} /></Field><button className="button secondary batch-apply" onClick={applyBatchSettings}>应用到所有组</button></div><div className="group-list">{settings.groups.map((group, index) => <article className="group-card" key={group.id}><span className="group-mark" style={{ background: group.color }}>{String.fromCharCode(65 + index)}</span><Field label="组名称"><input value={group.name} onChange={(event) => updateGroup(group.id, (item) => { item.name = event.target.value })} /></Field><Field label="n"><Numeric value={group.n} min={2} max={50} onChange={(value) => updateGroup(group.id, (item) => { item.n = value })} /></Field><Field label="目标均值"><Numeric value={group.targetMean} step={1} onChange={(value) => updateGroup(group.id, (item) => { item.targetMean = value })} /></Field><Field label="离散 SD"><Numeric value={group.targetSd} min={0.01} step={1} onChange={(value) => updateGroup(group.id, (item) => { item.targetSd = value })} /></Field><Field label="最小值"><Numeric value={group.minValue} step={0.1} onChange={(value) => updateGroup(group.id, (item) => { item.minValue = value })} /></Field><Field label="最大值"><OptionalNumeric value={group.maxValue} step={0.1} placeholder="不限制" onChange={(value) => updateGroup(group.id, (item) => { item.maxValue = value })} /></Field><button className="remove-group" disabled={settings.groups.length <= 2} title="删除组" onClick={() => removeGroup(group.id)}><X size={14} /></button></article>)}<button className="add-group" onClick={addGroup}><Plus size={17} />添加一组</button></div></>}
      </Section>

      <Section number={3} title="趋势与效应" subtitle="默认按每组手动填写的目标均值判断趋势；也可切换为递增、递减或各组接近"><div className="trend-control"><button className={settings.trend === 'custom' ? 'active' : ''} onClick={() => edit((draft) => { draft.trend = 'custom' })}>按手填均值</button><button className={settings.trend === 'ascending' ? 'active' : ''} onClick={() => edit((draft) => { draft.trend = 'ascending' })}>递增趋势</button><button className={settings.trend === 'descending' ? 'active' : ''} onClick={() => edit((draft) => { draft.trend = 'descending' })}>递减趋势</button><button className={settings.trend === 'similar' ? 'active' : ''} onClick={() => edit((draft) => { draft.trend = 'similar' })}>各组接近</button></div></Section>

      <Section number={4} title="p 值约束" subtitle={isTwoWay ? '从 m × k 单元格中勾选需要约束的两两组对；未勾选的只计算、不筛选' : '下拉勾选需要约束的组对；未勾选组对仍计算 p 值，但不参与候选筛选'}><PairwiseConstraintPanel settings={settings} onEdit={edit} /><p className="constraint-note">勾选的组对按所设 p 值区间筛选；未勾选的组对只完成计算，不做 p 值要求。双因素模式的组对比较使用 Welch pairwise，并进行 BH-FDR 校正。</p></Section>

      <Section number={5} title="随机设置" subtitle="默认每次使用新的安全随机 seed；锁定后才能复现同一候选"><div className="seed-row"><button className={`lock-toggle ${settings.seedMode === 'locked' ? 'locked' : ''}`} onClick={() => edit((draft) => { draft.seedMode = draft.seedMode === 'locked' ? 'random' : 'locked' })}>{settings.seedMode === 'locked' ? <Lock size={16} /> : <Unlock size={16} />}{settings.seedMode === 'locked' ? '已锁定 seed' : '每次全新随机'}</button><Field label="复现 seed" hint={settings.seedMode === 'random' ? '生成后在结果中记录自动 seed' : '相同参数与 seed 得到相同候选'}><input disabled={settings.seedMode === 'random'} value={settings.seed} onChange={(event) => edit((draft) => { draft.seed = event.target.value })} /></Field><button className="button primary generate-large" onClick={generate} disabled={generating}>{generating ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}{generating ? '正在随机搜索' : '生成 3 套候选'}</button></div></Section>
      </>}
    </div>

    {isTimeSeries && selectedTimeSeries ? <TimeSeriesResultColumn report={timeSeriesReport} selected={selectedTimeSeries} selectedIndex={timeSeriesSelectedIndex} setSelectedIndex={setTimeSeriesSelectedIndex} chartRef={chartRef} errorType={errorType} setErrorType={setErrorType} onCopy={copyTimeSeriesData} onExportCsv={exportTimeSeriesRawCsv} resultStatus={resultStatus} /> : <aside className="result-column panel">{resultStatus}<header className="result-header"><div><span className="step">6</span><div><h2>结果预览</h2><p>{report.message}</p></div></div><span className={`status ${selected?.status.toLowerCase()}`}>{selected?.status}</span></header><div className="candidate-tabs">{report.candidates.map((candidate, index) => <button className={selectedIndex === index ? 'active' : ''} onClick={() => setSelectedIndex(index)} key={candidate.id}><span>方案 {String.fromCharCode(65 + index)}</span><strong>p={formatP(candidate.test.pValue)}</strong><small>{candidate.status} · 第 {candidate.attempts} 次抽样</small></button>)}</div>
      {selected && <>
        <div className="result-toolbar">
          <div className="segmented"><button className={errorType === 'sd' ? 'active' : ''} onClick={() => setErrorType('sd')}>SD</button><button className={errorType === 'sem' ? 'active' : ''} onClick={() => setErrorType('sem')}>SEM</button><button className={errorType === 'ci' ? 'active' : ''} onClick={() => setErrorType('ci')}>95% CI</button></div>
          <button className="icon-text" onClick={exportPng}><Download size={14} />PNG</button>
        </div>
        <div className="chart"><ResultChart ref={chartRef} candidate={selected} settings={report.settings} errorType={errorType} /></div>
        <div className="target-result">
          <div><span>{selected.test.method === 'anova' ? 'ANOVA p 值' : '目标范围'}</span><strong>{selected.test.method === 'anova' ? formatP(selected.test.pValue) : constraintTarget(report.settings)}</strong></div>
          <div><span>实际 p 值</span><strong>{formatP(selected.test.pValue)}</strong></div>
          <div><span>{selected.test.method === 'anova' ? 'η² 效应量' : '效应量'}</span><strong>{selected.test.effectSize.toFixed(3)}</strong></div>
          <div><span>组数</span><strong>{selected.summaries.length}</strong></div>
        </div>
        <section className="stat-card">
          <header><div><h3>统计摘要</h3><p>{methodLabel(selected.test.method, selected.test.design)} · {selected.test.design === 'two-way' ? `残差 df=${selected.test.twoWay?.residualDegreesOfFreedom}` : selected.test.method === 'anova' ? `df=${selected.test.dfBetween},${selected.test.dfWithin}` : selected.test.tail}</p></div><span className="seed-display">seed {selected.seed.slice(0, 18)}…</span></header>
          <div className="summary-grid">{selected.summaries.map((summary, index) => <article key={summary.groupId}><span className="group-mark" style={{ background: report.settings.groups[index]?.color }}>{String.fromCharCode(65 + index)}</span><strong>{summary.name}</strong><dl><div><dt>n</dt><dd>{summary.n}</dd></div><div><dt>Mean</dt><dd>{summary.mean.toFixed(4)}</dd></div><div><dt>SD</dt><dd>{summary.sd.toFixed(4)}</dd></div><div><dt>SEM</dt><dd>{summary.sem.toFixed(4)}</dd></div></dl></article>)}</div>
          <div className="test-strip"><div><span>{selected.test.method === 'anova' ? 'F' : 't'}</span><strong>{selected.test.statistic.toFixed(4)}</strong></div><div><span>df</span><strong>{selected.test.method === 'anova' ? `${selected.test.dfBetween},${selected.test.dfWithin}` : selected.test.degreesOfFreedom.toFixed(3)}</strong></div><div><span>p</span><strong>{formatP(selected.test.pValue)}</strong></div><div><span>{selected.test.method === 'anova' ? 'η²' : "Cohen's d/dz"}</span><strong>{selected.test.effectSize.toFixed(3)}</strong></div></div>
          {selected.test.design === 'two-way' && selected.test.twoWay && <div className="two-way-results">{[selected.test.twoWay.factorA, selected.test.twoWay.factorB, selected.test.twoWay.interaction].map((effect) => <div key={effect.name}><strong>{effect.name}</strong><span>F({effect.degreesOfFreedom},{selected.test.twoWay!.residualDegreesOfFreedom})={effect.statistic.toFixed(3)}</span><b>p={formatP(effect.pValue)}</b></div>)}</div>}
        </section>
        {selected.test.method === 'anova' && selected.test.pairwise?.length ? <section className="pairwise-card"><header><div><h3>组间比较</h3><p>Welch pairwise + BH-FDR</p></div></header><div className="pairwise-list">{selected.test.pairwise.map((pair) => <div className="pairwise-row" key={`${pair.leftGroupId}-${pair.rightGroupId}`}><span>{pair.leftGroupName} vs {pair.rightGroupName}</span><strong>{pair.label}</strong><small>p={formatP(pair.pValue)} · FDR={formatP(pair.adjustedPValue)}</small></div>)}</div></section> : null}
        <section className="raw-card"><header><div><h3>原始数据</h3><p>{resultIsTwoWay ? '按因素 A × 因素 B 展开；表格结构与 Prism Grouped 一致' : '最终舍入值；复制到 Prism、R 或 Python 可独立回算'}</p></div><div><button className="icon-text" onClick={resultIsTwoWay ? copyGroupedData : copyData}><Copy size={14} />{resultIsTwoWay ? '复制 Prism 分组表' : '复制列数据'}</button><button className="icon-text" onClick={() => exportCsv(selected, report.settings)}><Download size={14} />CSV</button></div></header><div className="raw-table">{resultIsTwoWay ? <TwoWayRawTable candidate={selected} settings={report.settings} /> : <table><thead><tr><th>#</th>{selected.summaries.map((summary) => <th key={summary.groupId}>{summary.name}</th>)}</tr></thead><tbody>{Array.from({ length: Math.max(...selected.values.map((values) => values.length)) }, (_, index) => <tr key={index}><td>{index + 1}</td>{selected.values.map((values, groupIndex) => <td key={selected.summaries[groupIndex]?.groupId}>{values[index] ?? ''}</td>)}</tr>)}</tbody></table>}</div></section>
        <section className="checks-card"><header><ShieldCheck size={17} /><h3>约束验证</h3><span>{report.attempts.toLocaleString()} 次完整随机抽样</span></header>{selected.checks.map((check) => <div className={`check-row ${check.status.toLowerCase()}`} key={check.label}>{check.status === 'PASS' ? <Check size={15} /> : check.status === 'WARN' ? <AlertTriangle size={15} /> : <X size={15} />}<strong>{check.label}</strong><span>{check.detail}</span></div>)}</section>
      </>}
    </aside>}</div><footer>SIMULATED / 合成模拟数据　·　生成日志、约束和随机 seed 随项目导出　·　不代表真实实验观测</footer>{notice && <div className="toast" onClick={() => setNotice('')}>{notice}</div>}
  </main>
}
