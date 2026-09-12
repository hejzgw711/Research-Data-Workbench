import { useState, type FormEvent } from 'react'
import CombinedApp from './CombinedApp'
import { AUTH_STORAGE_KEY, hasStoredSession } from './authSession'

const ACCOUNT = 'bigNBny'
const PASSWORD_SHA256 = 'a721200c375289479a02127718f6bc25b64c5a5e87a71ec9735f3e1842d34886'

async function sha256(value: string) {
  if (!window.crypto?.subtle) throw new Error('当前浏览器不支持安全密码校验，请使用最新版浏览器。')
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default function AuthGate() {
  const [authenticated, setAuthenticated] = useState(hasStoredSession)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (username !== ACCOUNT) {
      setError('账号或密码错误。')
      return
    }
    setSubmitting(true)
    try {
      if (await sha256(password) !== PASSWORD_SHA256) {
        setError('账号或密码错误。')
        return
      }
      try {
        const storage = remember ? window.localStorage : window.sessionStorage
        storage.setItem(AUTH_STORAGE_KEY, '1')
        const otherStorage = remember ? window.sessionStorage : window.localStorage
        otherStorage.removeItem(AUTH_STORAGE_KEY)
      } catch {
        setError('浏览器存储不可用，请允许本站点使用本地存储后重试。')
        return
      }
      setPassword('')
      setAuthenticated(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  const logout = () => {
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
    } catch {
      // Storage may be unavailable; the in-memory state still ends the session.
    }
    setAuthenticated(false)
    setUsername('')
    setPassword('')
    setError('')
  }

  if (authenticated) return <CombinedApp onLogout={logout} />

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <span className="auth-eyebrow">RESEARCH DATA WORKBENCH</span>
        <h1 id="auth-title">生成可分析科研数据工作台</h1>
        <p className="auth-subtitle">请输入账号密码进入本地科研工作台</p>
        <form className="auth-form" onSubmit={login}>
          <label className="auth-field">
            <span>账号</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label className="auth-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="auth-remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span>在此浏览器保持登录</span>
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? '验证中…' : '登录'}
          </button>
        </form>
        <p className="auth-note">数据生成与分析仍在当前浏览器内完成。</p>
      </section>
    </main>
  )
}
