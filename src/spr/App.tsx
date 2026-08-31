import { useMemo, useState } from 'react'
import './styles.css'
import {
  BarChart3,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileArchive,
  FlaskConical,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
} from 'lucide-react'
import SensorgramChart from './components/SensorgramChart'
import {
  buildPlotTable,
  buildRawTable,
  downloadDatasetZip,
  downloadText,
  experimentMetadata,
  tableToCsv,
  tableToTsv,
  type ReplicateView,
} from './core/export'
import {
  concentrationToDisplay,
  defaultSettings,
  simulateExperiment,
} from './core/simulator'
import type { CurveKey, SimulationResult, SimulationSettings } from './core/types'

type TabKey = 'chart' | 'plot-data' | 'raw-data' | 'metadata'

const curveOptions: Array<{ value: CurveKey; label: string }> = [
  { value: 'doubleReferencedRU', label: 'Double referenced' },
  { value: 'baselineCorrectedRU', label: 'Baseline corrected' },
  { value: 'fc2MinusFc1RU', label: 'Fc2-Fc1' },
  { value: 'fc1RU', label: 'Fc1 raw' },
  { value: 'fc2RU', label: 'Fc2 raw' },
  { value: 'modelTruthRU', label: 'Model truth' },
]

const formatValue = (value: number, digits = 3) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)).toString() : '—'

interface NumberFieldProps {
  label: string
  value: number
  unit?: string
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}

function NumberField({ label, value, unit, min, max, step, onChange }: NumberFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-with-unit">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  )
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="section-title">
      <span>{index}</span>
      <h2>{title}</h2>
    </div>
  )
}

function DataPreview({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, columnIndex) => (
                <td key={`${rowIndex}-${columnIndex}`}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function App() {
  const [draft, setDraft] = useState<SimulationSettings>(defaultSettings)
  const [result, setResult] = useState<SimulationResult>(() => simulateExperiment(defaultSettings))
  const [activeTab, setActiveTab] = useState<TabKey>('chart')
  const [chartMode, setChartMode] = useState<'overlay' | 'single'>('overlay')
  const [curve, setCurve] = useState<CurveKey>('doubleReferencedRU')
  const [replicateView, setReplicateView] = useState<ReplicateView>('separate')
  const [cycleId, setCycleId] = useState(result.cycles[0]?.plan.id ?? 1)
  const [message, setMessage] = useState('')

  const plotTable = useMemo(
    () => buildPlotTable(result, curve, replicateView),
    [result, curve, replicateView],
  )
  const rawTable = useMemo(() => buildRawTable(result), [result])

  const update = <Key extends keyof SimulationSettings>(
    key: Key,
    value: SimulationSettings[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }))

  const generate = () => {
    try {
      const nextResult = simulateExperiment(draft)
      setResult(nextResult)
      setCycleId(nextResult.cycles.find((cycle) => cycle.plan.kind === 'sample')?.plan.id ?? 1)
      setMessage(`已生成 ${nextResult.cycles.length} 个循环、${nextResult.points.length} 个采样点`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成失败，请检查参数。')
    }
  }

  const copyPlotData = async () => {
    await navigator.clipboard.writeText(tableToTsv(plotTable))
    setMessage('当前作图表已复制，可直接粘贴到 Excel、Origin 或 Prism')
  }

  const downloadJson = () => {
    downloadText(
      JSON.stringify(experimentMetadata(result), null, 2),
      `${result.settings.outputPrefix}-experiment.json`,
      'application/json;charset=utf-8',
    )
  }

  return (
    <div className="spr-mode app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><FlaskConical aria-hidden="true" /></span>
          <div>
            <strong>WB / SPR 科研数据工作台</strong>
            <small>SPR SYNTHETIC SENSORGRAM GENERATOR</small>
          </div>
        </div>
        <div className="top-status"><Sparkles size={15} /> Seed {result.settings.seed}</div>
      </header>

      <main className="workspace">
        <aside className="parameter-column">
          <section className="intro-panel">
            <span>DATA BLUEPRINT</span>
            <h1>生成可分析的 SPR 数据</h1>
            <p>独立生成完整循环、双通道曲线、处理后数据和可直接作图的表格。</p>
          </section>

          <div className="parameter-grid">
            <section className="panel">
              <SectionTitle index="01" title="模板与样品" />
              <label className="field">
                <span>分析软件记录名称</span>
                <input value={draft.experimentName} onChange={(event) => update('experimentName', event.target.value)} />
              </label>
              <div className="field-pair">
                <label className="field">
                  <span>样品名</span>
                  <input value={draft.sampleName} onChange={(event) => update('sampleName', event.target.value)} />
                </label>
                <label className="field">
                  <span>配体名</span>
                  <input value={draft.ligandName} onChange={(event) => update('ligandName', event.target.value)} />
                </label>
              </div>
              <NumberField label="分子量" value={draft.molecularWeightDa} unit="Da" min={0} step={100} onChange={(value) => update('molecularWeightDa', value)} />
              <label className="field">
                <span>输出文件名前缀</span>
                <input value={draft.outputPrefix} onChange={(event) => update('outputPrefix', event.target.value)} />
              </label>
            </section>

            <section className="panel">
              <SectionTitle index="02" title="浓度与循环" />
              <label className="field">
                <span>浓度序列（逗号分隔）</span>
                <textarea rows={4} value={draft.concentrationsText} onChange={(event) => update('concentrationsText', event.target.value)} />
              </label>
              <div className="field-pair three">
                <label className="field">
                  <span>单位</span>
                  <select value={draft.concentrationUnit} onChange={(event) => update('concentrationUnit', event.target.value as SimulationSettings['concentrationUnit'])}>
                    <option value="pM">pM</option>
                    <option value="nM">nM</option>
                    <option value="uM">μM</option>
                    <option value="mM">mM</option>
                  </select>
                </label>
                <NumberField label="样品重复" value={draft.replicates} min={1} max={6} step={1} onChange={(value) => update('replicates', value)} />
                <NumberField label="Startup" value={draft.startupCycles} min={0} max={8} step={1} onChange={(value) => update('startupCycles', value)} />
              </div>
              <NumberField label="Solvent 循环" value={draft.solventCycles} min={0} max={8} step={1} onChange={(value) => update('solventCycles', value)} />
            </section>

            <section className="panel full-width">
              <SectionTitle index="03" title="1:1 动力学" />
              <div className="field-pair three">
                <NumberField label="kₐ" value={draft.ka} unit="M⁻¹s⁻¹" min={0} step={100} onChange={(value) => update('ka', value)} />
                <NumberField label="k_d" value={draft.kd} unit="s⁻¹" min={0} step={0.001} onChange={(value) => update('kd', value)} />
                <NumberField label="Rmax" value={draft.rmaxRU} unit="RU" min={0} step={10} onChange={(value) => update('rmaxRU', value)} />
              </div>
              <div className="formula-strip">
                <span>K<sub>D</sub> = k<sub>d</sub> / k<sub>a</sub></span>
                <strong>{concentrationToDisplay(result.kdM)}</strong>
                <span>t½ = {formatValue(result.halfLifeS, 1)} s</span>
              </div>
            </section>

            <section className="panel full-width">
              <SectionTitle index="04" title="采集与扰动" />
              <div className="field-pair three">
                <NumberField label="基线" value={draft.baselineS} unit="s" min={1} onChange={(value) => update('baselineS', value)} />
                <NumberField label="结合" value={draft.associationS} unit="s" min={1} onChange={(value) => update('associationS', value)} />
                <NumberField label="解离" value={draft.dissociationS} unit="s" min={1} onChange={(value) => update('dissociationS', value)} />
              </div>
              <div className="field-pair three">
                <NumberField label="采样间隔" value={draft.samplingIntervalS} unit="s" min={0.1} step={0.1} onChange={(value) => update('samplingIntervalS', value)} />
                <NumberField label="Fc1 基线" value={draft.fc1BaselineRU} unit="RU" min={0} onChange={(value) => update('fc1BaselineRU', value)} />
                <NumberField label="Fc2 基线" value={draft.fc2BaselineRU} unit="RU" min={0} onChange={(value) => update('fc2BaselineRU', value)} />
              </div>
              <div className="field-pair three">
                <NumberField label="噪声 SD" value={draft.noiseSDRU} unit="RU" min={0} step={0.1} onChange={(value) => update('noiseSDRU', value)} />
                <NumberField label="Bulk RI" value={draft.bulkRIRU} unit="RU" min={0} step={1} onChange={(value) => update('bulkRIRU', value)} />
                <NumberField label="注射尖峰" value={draft.spikeRU} unit="RU" min={0} step={1} onChange={(value) => update('spikeRU', value)} />
              </div>
              <div className="field-pair three">
                <NumberField label="基线漂移" value={draft.driftRUPerS} unit="RU/s" min={0} step={0.0005} onChange={(value) => update('driftRUPerS', value)} />
                <NumberField label="浓度 CV" value={draft.concentrationCvPct} unit="%" min={0} max={50} step={0.5} onChange={(value) => update('concentrationCvPct', value)} />
                <NumberField label="Rmax CV" value={draft.rmaxCvPct} unit="%" min={0} max={50} step={0.5} onChange={(value) => update('rmaxCvPct', value)} />
              </div>
              <div className="generate-row">
                <NumberField label="随机 Seed" value={draft.seed} step={1} onChange={(value) => update('seed', value)} />
                <button className="primary-button" onClick={generate}><Play size={17} /> 生成数据</button>
              </div>
            </section>
          </div>
        </aside>

        <section className="result-column">
          <section className="panel result-panel">
            <div className="result-heading">
              <div>
                <span>LIVE SENSORGRAM</span>
                <h2>响应曲线与数据预览</h2>
              </div>
              <div className="ready-indicator"><CheckCircle2 size={16} /> 数据就绪</div>
            </div>

            <nav className="tabs" aria-label="结果视图">
              {([
                ['chart', '曲线预览', BarChart3],
                ['plot-data', '作图表格', Clipboard],
                ['raw-data', '完整原始数据', Database],
                ['metadata', '实验信息', Settings2],
              ] as const).map(([key, label, Icon]) => (
                <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </nav>

            {activeTab === 'chart' && (
              <>
                <div className="chart-controls">
                  <div className="segmented">
                    <button className={chartMode === 'overlay' ? 'active' : ''} onClick={() => setChartMode('overlay')}>全部叠加</button>
                    <button className={chartMode === 'single' ? 'active' : ''} onClick={() => setChartMode('single')}>单循环</button>
                  </div>
                  <label>
                    <span>Cycle</span>
                    <select value={cycleId} disabled={chartMode === 'overlay'} onChange={(event) => setCycleId(Number(event.target.value))}>
                      {result.cycles.map((cycle) => <option key={cycle.plan.id} value={cycle.plan.id}>Cycle {cycle.plan.id} · {cycle.plan.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Curve</span>
                    <select value={curve} onChange={(event) => setCurve(event.target.value as CurveKey)}>
                      {curveOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="chart-wrap">
                  <SensorgramChart result={result} mode={chartMode} cycleId={cycleId} curve={curve} />
                </div>
                <div className="summary-grid">
                  <div><span>样本循环</span><strong>{result.sampleCycleCount}</strong><small>浓度 × 重复</small></div>
                  <div><span>总采样点</span><strong>{result.points.length.toLocaleString()}</strong><small>完整实验逐点数据</small></div>
                  <div className="status-summary"><span>数据层级</span><strong>L0–L3 已生成</strong><small>Truth · Raw · Processed · Plot</small></div>
                </div>
              </>
            )}

            {activeTab === 'plot-data' && (
              <div className="data-view">
                <div className="view-toolbar">
                  <div>
                    <h3>可直接作图的宽表</h3>
                    <p>Association 开始时间定义为 0，基线时间为负值。</p>
                  </div>
                  <label>
                    <span>重复展示</span>
                    <select value={replicateView} onChange={(event) => setReplicateView(event.target.value as ReplicateView)}>
                      <option value="separate">分开显示</option>
                      <option value="mean-sd">Mean ± SD</option>
                    </select>
                  </label>
                </div>
                <DataPreview headers={plotTable.headers} rows={plotTable.rows.slice(0, 12)} />
                <p className="table-note">预览前 12 行，共 {plotTable.rows.length} 行；导出包含全部数据。</p>
              </div>
            )}

            {activeTab === 'raw-data' && (
              <div className="data-view">
                <div className="view-toolbar">
                  <div>
                    <h3>完整实验逐点数据</h3>
                    <p>包含 Startup、Sample、Solvent 以及 Truth、Raw、Processed 和扰动分量。</p>
                  </div>
                </div>
                <DataPreview headers={rawTable.headers.slice(0, 13)} rows={rawTable.rows.slice(0, 10).map((row) => row.slice(0, 13))} />
                <p className="table-note">预览 13 列 × 10 行；完整 CSV 共 {rawTable.headers.length} 列 × {rawTable.rows.length} 行。</p>
              </div>
            )}

            {activeTab === 'metadata' && (
              <div className="metadata-grid">
                <div><span>模型</span><strong>1:1 Langmuir</strong></div>
                <div><span>kₐ</span><strong>{result.settings.ka.toLocaleString()} M⁻¹s⁻¹</strong></div>
                <div><span>k_d</span><strong>{result.settings.kd} s⁻¹</strong></div>
                <div><span>K<sub>D</sub></span><strong>{concentrationToDisplay(result.kdM)}</strong></div>
                <div><span>Rmax</span><strong>{result.settings.rmaxRU} RU</strong></div>
                <div><span>Seed</span><strong>{result.settings.seed}</strong></div>
                <div><span>合成标记</span><strong>synthetic = true</strong></div>
                <div><span>版本</span><strong>0.1.0</strong></div>
              </div>
            )}
          </section>

          <section className="panel export-panel">
            <div className="result-heading compact">
              <div>
                <span>EXPORT</span>
                <h2>复制与生成数据文件</h2>
              </div>
              <small>所有文件明确标记 synthetic = true</small>
            </div>
            <div className="export-grid">
              <button onClick={copyPlotData}><Clipboard size={17} /><span>复制作图表<small>TSV · Excel / Origin / Prism</small></span></button>
              <button onClick={() => downloadText(tableToCsv(plotTable), `${result.settings.outputPrefix}-plot.csv`)}><Download size={17} /><span>下载作图 CSV<small>当前曲线与重复模式</small></span></button>
              <button onClick={() => downloadText(tableToCsv(rawTable), `${result.settings.outputPrefix}-raw.csv`)}><Database size={17} /><span>下载原始 CSV<small>全部循环与逐点分量</small></span></button>
              <button onClick={downloadJson}><Download size={17} /><span>实验 JSON<small>参数、Seed 与 Cycle plan</small></span></button>
            </div>
            <button className="dataset-button" onClick={() => downloadDatasetZip(result, curve, replicateView)}>
              <FileArchive size={19} />
              <span>生成完整 SPR Dataset<small>Raw · Processed · Plot · Ground truth · Metadata</small></span>
            </button>
          </section>
        </section>
      </main>

      <footer>
        <span>SPR Synthetic Data Studio · 所有计算均在当前浏览器内完成</span>
        <span>合成数据仅用于科研教学和算法测试，不代表真实实验结果</span>
      </footer>

      {message && (
        <button className="toast" onClick={() => setMessage('')}>
          <RefreshCw size={15} /> {message}
        </button>
      )}
    </div>
  )
}
