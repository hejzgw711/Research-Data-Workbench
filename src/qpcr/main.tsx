import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { hasStoredSession } from '../authSession'
import './styles.css'

if (window.parent === window) {
  const workspace = new URL('../', window.location.href)
  workspace.hash = 'qpcr'
  window.location.replace(workspace.href)
} else if (!hasStoredSession()) {
  window.parent.postMessage({ type: 'qpcr-session-expired' }, window.location.origin)
  document.getElementById('root')!.textContent = '请先登录科研工作台。'
} else {
  void import('./App').then(({ default: App }) => {
    createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
  })
}
