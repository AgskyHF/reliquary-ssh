import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import './styles/global.css'
import './styles/layout.css'
import './styles/terminal.css'
import './styles/files.css'
import './styles/keychain.css'
import './styles/hosts.css'
import './styles/auth.css'
import './styles/sync.css'
import './styles/settings.css'
import './styles/transfer.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root not found')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
