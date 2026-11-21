
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VoiceAssistant from './VoiceAssistant.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <>
      <App />
      <VoiceAssistant />
    </>
  </StrictMode>,
)
