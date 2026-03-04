import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { DirectionProvider } from '@radix-ui/react-direction'
import { Toaster } from '@/components/ui/toaster'
import App from './App'
import { seedDatabase } from '@/lib/db/seeder'
import { initSync } from '@/lib/sync/syncEngine'
import { useUiStore } from '@/store/uiStore'
import './index.css'

// Apply theme immediately before render to avoid flash
const savedState = localStorage.getItem('yeshiva-ui')
if (savedState) {
  try {
    const parsed = JSON.parse(savedState)
    if (parsed?.state?.theme === 'dark') {
      document.documentElement.classList.add('dark')
    }
  } catch {}
}

// Initialize sync engine
initSync()

// Seed database with demo data (only on first run)
seedDatabase().catch(console.error)

const container = document.getElementById('root')!
const root = createRoot(container)

root.render(
  <StrictMode>
    <DirectionProvider dir="rtl">
      <BrowserRouter>
        <App />
        <Toaster />
      </BrowserRouter>
    </DirectionProvider>
  </StrictMode>
)
