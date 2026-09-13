import { createContext, useContext, type ReactNode } from 'react'
import { LogOut, Moon, Sun } from 'lucide-react'
import './workbench-theme.css'

export type WorkbenchTheme = 'light' | 'dark'
export const WORKBENCH_THEME_KEY = 'research-data-workbench-theme'
export const WorkbenchThemeContext = createContext<{ theme: WorkbenchTheme; toggleTheme: () => void }>({ theme: 'light', toggleTheme: () => {} })
export const useWorkbenchTheme = () => useContext(WorkbenchThemeContext)

export function WorkbenchHeader({ subtitle, onLogout, children }: { subtitle: string; onLogout?: () => void; children?: ReactNode }) {
  const { theme, toggleTheme } = useWorkbenchTheme()
  const themeLabel = theme === 'light' ? '切换到深色主题' : '切换到浅色主题'
  return <header className="workbench-header">
    <div className="workbench-brand"><span>RESEARCH DATA WORKBENCH</span><h1>生成可分析科研数据工作台</h1><p>{subtitle}</p></div>
    <div className="workbench-controls">
      <div className="workbench-actions">{children}</div>
      <div className="workbench-utilities">
        <button type="button" className="workbench-theme-toggle" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>{theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</button>
        {onLogout && <button type="button" className="workbench-logout" onClick={onLogout}><LogOut size={17} aria-hidden="true" />退出登录</button>}
      </div>
    </div>
  </header>
}
