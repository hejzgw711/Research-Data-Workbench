export const AUTH_STORAGE_KEY = 'research-data-workbench-authenticated'

/** Existing browser-only gate; this is not server-side authorization. */
export function hasStoredSession() {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) === '1'
      || window.sessionStorage.getItem(AUTH_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
