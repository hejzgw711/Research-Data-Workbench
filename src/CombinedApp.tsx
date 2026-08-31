import { FlaskConical, Image as ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { WbApp } from './App'
import SprApp from './spr/App'

type Mode = 'wb' | 'spr'

function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <nav className="combined-switcher" aria-label="科研工具模式">
      <button className={mode === 'wb' ? 'active' : ''} onClick={() => onChange('wb')}>
        <ImageIcon size={16} /> WB 灰度测量
      </button>
      <button className={mode === 'spr' ? 'active' : ''} onClick={() => onChange('spr')}>
        <FlaskConical size={16} /> SPR 数据生成
      </button>
    </nav>
  )
}

export default function CombinedApp() {
  const [mode, setMode] = useState<Mode>('wb')
  return (
    <div className={`combined-shell ${mode === 'wb' ? 'wb-mode' : 'spr-mode-active'}`}>
      <ModeSwitcher mode={mode} onChange={setMode} />
      <div className="mode-content">{mode === 'wb' ? <WbApp /> : <SprApp />}</div>
    </div>
  )
}
