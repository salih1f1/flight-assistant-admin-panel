import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { msalInstance } from '@/auth/msalConfig'

msalInstance.initialize().then(() => {
  createRoot(document.getElementById('root')!).render(<App />)
})
