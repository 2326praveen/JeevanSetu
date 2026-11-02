import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import SOSScreen from './screens/SOSScreen'
import ConfirmationScreen from './screens/ConfirmationScreen'
import SafetyGuidanceScreen from './screens/SafetyGuidanceScreen'
import AdminScreen from './screens/AdminScreen'
import ChatAssistantScreen from './screens/ChatAssistantScreen'

function App() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <div className={`app-container ${isAdmin ? 'admin-layout' : ''}`}>
      {isOffline && (
        <div className="offline-banner">
          ⚠️ You are offline. SOS will be queued and sent when reconnected.
        </div>
      )}
      <header className="app-header">
        <h1>JeevanSetu AI</h1>
        <nav className="nav-links">
          <Link to="/">SOS</Link>
          <Link to="/assistant">Assistant</Link>
          <Link to="/safety-guidance">Safety</Link>
          <Link to="/admin">Authority</Link>
        </nav>
      </header>
      
      <main className="main-content">
        <Routes>
          <Route path="/" element={<SOSScreen isOffline={isOffline} />} />
          <Route path="/assistant" element={<ChatAssistantScreen />} />
          <Route path="/confirmation/:ticketId" element={<ConfirmationScreen />} />
          <Route path="/safety-guidance" element={<SafetyGuidanceScreen />} />
          <Route path="/admin" element={<AdminScreen />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
