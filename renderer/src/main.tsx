import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import './styles/global.css'
import './styles/layout.css'
import './styles/terminal.css'
import './styles/files.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root not found')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
