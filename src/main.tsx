import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './CombinedApp'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
