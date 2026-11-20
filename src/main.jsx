import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import IgoAssistant from './IgoAssistant.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <IgoAssistant />
  </StrictMode>,
)
