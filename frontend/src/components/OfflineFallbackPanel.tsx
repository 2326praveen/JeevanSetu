import { useState, useEffect } from 'react'
import {
  WifiOff,
  MessageSquare,
  MapPin,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Download,
  Smartphone,
  Map,
  CloudOff,
  ArrowUpCircle
} from 'lucide-react'
import {
  generateSmsLink,
  encodeSmsPayload,
  getAllPendingRequests,
  syncOfflineQueue,
  precacheRegionTiles,
  getTileCacheInfo,
  QueuedRequest
} from '../utils/offline'

interface OfflineFallbackPanelProps {
  isOffline: boolean
  userLat?: number | null
  userLng?: number | null
}

export default function OfflineFallbackPanel({ isOffline, userLat, userLng }: OfflineFallbackPanelProps) {
  const [emergencyType, setEmergencyType] = useState('flood')
  const [peopleCount, setPeopleCount] = useState(1)
  const [vulnFlags, setVulnFlags] = useState<string[]>([])
  const [messageText, setMessageText] = useState('')
  const [smsLink, setSmsLink] = useState<string | null>(null)
  const [smsBody, setSmsBody] = useState('')

  // Queue state
  const [pendingQueue, setPendingQueue] = useState<QueuedRequest[]>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  // Tile cache state
  const [isCaching, setIsCaching] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<{ estimatedTiles: number; available: boolean }>({ estimatedTiles: 0, available: false })
  const [cacheMsg, setCacheMsg] = useState<string | null>(null)

  // Load queue status and tile cache info
  useEffect(() => {
    loadQueueStatus()
    loadCacheInfo()
  }, [isOffline])

  const loadQueueStatus = async () => {
    try {
      const queue = await getAllPendingRequests()
      setPendingQueue(queue)
    } catch (e) {
      console.warn('Failed to load offline queue:', e)
    }
  }

  const loadCacheInfo = async () => {
    try {
      const info = await getTileCacheInfo()
      setCacheInfo(info)
    } catch {
      // Cache API unavailable
    }
  }

  // Generate SMS link whenever inputs change
  useEffect(() => {
    const link = generateSmsLink({
      lat: userLat,
      lng: userLng,
      emergencyType,
      peopleAtRisk: peopleCount,
      vulnerableFlags: vulnFlags,
      message: messageText || 'SOS Emergency'
    })
    setSmsLink(link)

    const body = encodeSmsPayload({
      lat: userLat,
      lng: userLng,
      emergencyType,
      peopleAtRisk: peopleCount,
      vulnerableFlags: vulnFlags,
      message: messageText || 'SOS Emergency'
    })
    setSmsBody(body)
  }, [userLat, userLng, emergencyType, peopleCount, vulnFlags, messageText])

  // Toggle vulnerability flags
  const toggleFlag = (flag: string) => {
    setVulnFlags(prev =>
      prev.includes(flag) ? prev.filter(f => f !== flag) : [...prev, flag]
    )
  }

  // Sync queued SOS when online
  const handleSync = async () => {
    setIsSyncing(true)
    setSyncResult(null)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
      const result = await syncOfflineQueue(supabaseUrl, anonKey)
      setSyncResult(`✅ Synced ${result.synced} SOS reports${result.failed > 0 ? `, ${result.failed} failed (will retry)` : ''}`)
      await loadQueueStatus()
    } catch (err: any) {
      setSyncResult(`❌ Sync failed: ${err.message}`)
    } finally {
      setIsSyncing(false)
    }
  }

  // Pre-cache map tiles
  const handleCacheTiles = async () => {
    setIsCaching(true)
    setCacheMsg(null)
    try {
      const lat = userLat || 12.9716
      const lng = userLng || 77.5946
      const result = await precacheRegionTiles(lat, lng, [10, 11, 12, 13])
      setCacheMsg(`✅ Cached ${result.cached} tiles for your region (zoom 10-13)`)
      await loadCacheInfo()
    } catch (err: any) {
      setCacheMsg(`❌ Tile caching failed: ${err.message}`)
    } finally {
      setIsCaching(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.9rem',
      background: isOffline ? '#fff8e1' : '#ffffff',
      borderRadius: '12px',
      padding: '1rem',
      border: isOffline ? '2px solid #f9a825' : '1.5px solid var(--border-color)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.06)'
    }}>

      {/* 1. Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.45rem', color: isOffline ? '#e65100' : '#1565c0' }}>
            {isOffline ? <WifiOff size={18} color="#e65100" /> : <CloudOff size={18} color="#1565c0" />}
            {isOffline ? 'Offline Emergency Mode' : 'Offline Readiness & Fallback'}
          </h3>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>
            SMS-SOS fallback, cached maps, and queued report sync
          </span>
        </div>

        {/* Connection Status Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.25rem 0.65rem',
          borderRadius: '20px',
          fontSize: '0.75rem',
          fontWeight: 700,
          background: isOffline ? '#ffebee' : '#e8f5e9',
          color: isOffline ? '#c62828' : '#2e7d32'
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isOffline ? '#d32f2f' : '#4caf50',
            display: 'inline-block'
          }} />
          {isOffline ? 'OFFLINE' : 'ONLINE'}
        </div>
      </div>

      {/* 2. SMS-SOS Fallback Panel */}
      <div style={{
        background: isOffline ? '#fff3e0' : '#f5f9ff',
        border: `1px solid ${isOffline ? '#ffe0b2' : '#bbdefb'}`,
        borderRadius: '8px',
        padding: '0.85rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.55rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.15rem' }}>
          <MessageSquare size={16} color={isOffline ? '#e65100' : '#1565c0'} />
          <strong style={{ fontSize: '0.85rem' }}>SMS-SOS Fallback (No Internet Required)</strong>
        </div>

        <div style={{ fontSize: '0.78rem', color: '#555' }}>
          Opens your native SMS app with compact-encoded location and emergency details. Works with zero data connectivity.
        </div>

        {/* Emergency Type & People */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, display: 'block', marginBottom: '0.15rem' }}>Emergency Type</label>
            <select
              aria-label="Emergency type"
              value={emergencyType}
              onChange={e => setEmergencyType(e.target.value)}
              style={{ width: '100%', padding: '0.35rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.8rem' }}
            >
              <option value="flood">🌊 Flood / Waterlogging</option>
              <option value="fire">🔥 Fire / Gas Leak</option>
              <option value="earthquake">🌍 Earthquake / Tremor</option>
              <option value="cyclone">🌀 Cyclone / Storm</option>
              <option value="landslide">⛰️ Landslide / Mudslide</option>
              <option value="medical">🏥 Medical Emergency</option>
              <option value="collapse">🏚️ Building Collapse</option>
              <option value="trapped">🚧 Trapped / Blocked</option>
              <option value="other">🆘 Other Emergency</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, display: 'block', marginBottom: '0.15rem' }}>People at Risk</label>
            <input
              type="number"
              min={1}
              max={99}
              value={peopleCount}
              onChange={e => setPeopleCount(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ width: '100%', padding: '0.35rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.8rem' }}
            />
          </div>
        </div>

        {/* Vulnerability Flags */}
        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 600, display: 'block', marginBottom: '0.15rem' }}>Vulnerable Persons</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {[
              { key: 'elderly', label: '👴 Elderly' },
              { key: 'infant', label: '👶 Infant' },
              { key: 'pregnant', label: '🤰 Pregnant' },
              { key: 'disabled', label: '♿ Disabled' },
              { key: 'child', label: '🧒 Children' },
              { key: 'medical_condition', label: '💊 Medical' }
            ].map(f => (
              <button
                key={f.key}
                onClick={() => toggleFlag(f.key)}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: '12px',
                  border: '1px solid #ccc',
                  fontSize: '0.72rem',
                  fontWeight: vulnFlags.includes(f.key) ? 700 : 400,
                  background: vulnFlags.includes(f.key) ? '#ffcdd2' : '#fff',
                  color: vulnFlags.includes(f.key) ? '#b71c1c' : '#333',
                  cursor: 'pointer'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Short Message */}
        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 600, display: 'block', marginBottom: '0.15rem' }}>Brief Message (30 chars max)</label>
          <input
            type="text"
            maxLength={30}
            placeholder="e.g. Water 4ft house trapped"
            value={messageText}
            onChange={e => setMessageText(e.target.value)}
            style={{ width: '100%', padding: '0.35rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.8rem' }}
          />
        </div>

        {/* GPS coordinates display */}
        <div style={{ fontSize: '0.72rem', color: '#777', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <MapPin size={12} />
          GPS: {userLat ? `${userLat.toFixed(4)}, ${userLng?.toFixed(4)}` : 'Acquiring...'}
        </div>

        {/* SMS Preview */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '0.5rem', fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all', color: '#333' }}>
          <div style={{ fontSize: '0.65rem', color: '#999', marginBottom: '0.15rem' }}>SMS PAYLOAD PREVIEW:</div>
          {smsBody}
        </div>

        {/* Send SMS Button */}
        <a
          href={smsLink || '#'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            background: isOffline
              ? 'linear-gradient(135deg, #e65100, #bf360c)'
              : 'linear-gradient(135deg, #1565c0, #0d47a1)',
            color: '#fff',
            padding: '0.65rem',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: '0.9rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
        >
          <Smartphone size={18} />
          <Send size={16} />
          Open SMS App with SOS (To: 112)
        </a>

        <div style={{ fontSize: '0.68rem', color: '#888', textAlign: 'center' }}>
          💡 Future: Twilio & WhatsApp Business API integration for automated SMS gateway (documented as roadmap).
        </div>
      </div>

      {/* 3. Queued Reports Sync Panel */}
      <div style={{
        background: '#f8f9fa',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <ArrowUpCircle size={16} color="#1565c0" />
            <strong style={{ fontSize: '0.85rem' }}>Offline Queue & Sync</strong>
          </div>
          <span style={{
            fontSize: '0.72rem',
            padding: '0.15rem 0.45rem',
            borderRadius: '12px',
            fontWeight: 700,
            background: pendingQueue.length > 0 ? '#fff3e0' : '#e8f5e9',
            color: pendingQueue.length > 0 ? '#e65100' : '#2e7d32'
          }}>
            {pendingQueue.length} Pending
          </span>
        </div>

        {pendingQueue.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {pendingQueue.slice(0, 5).map(req => (
              <div
                key={req.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#fff',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '4px',
                  border: '1px solid #eee',
                  fontSize: '0.75rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <AlertTriangle size={12} color="#e65100" />
                  <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{req.type.replace('_', ' ')}</span>
                </div>
                <span style={{ color: '#999', fontSize: '0.68rem' }}>
                  {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {req.retryCount > 0 && ` (retry ${req.retryCount})`}
                </span>
              </div>
            ))}

            {!isOffline && (
              <button
                onClick={handleSync}
                disabled={isSyncing}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  background: '#1976d2',
                  color: '#fff',
                  border: 'none',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  marginTop: '0.25rem'
                }}
              >
                {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <ArrowUpCircle size={14} />}
                Sync Queued Reports Now
              </button>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '0.5rem', color: '#888', fontSize: '0.8rem' }}>
            <CheckCircle2 size={18} color="#2e7d32" style={{ margin: '0 auto 0.25rem' }} />
            <div>No pending reports. All synced!</div>
          </div>
        )}

        {syncResult && (
          <div style={{ fontSize: '0.78rem', color: syncResult.startsWith('✅') ? '#2e7d32' : '#c62828', background: syncResult.startsWith('✅') ? '#e8f5e9' : '#ffebee', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
            {syncResult}
          </div>
        )}
      </div>

      {/* 4. Cached Map Tiles Panel */}
      <div style={{
        background: '#f8f9fa',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Map size={16} color="#1565c0" />
            <strong style={{ fontSize: '0.85rem' }}>Emergency Map Tile Cache</strong>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#666' }}>
            {cacheInfo.estimatedTiles} tiles cached
          </span>
        </div>

        <div style={{ fontSize: '0.78rem', color: '#555' }}>
          Pre-download OSM map tiles for your area so evacuation maps load without internet.
        </div>

        <button
          onClick={handleCacheTiles}
          disabled={isCaching || isOffline}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            background: isOffline ? '#e0e0e0' : '#2e7d32',
            color: isOffline ? '#999' : '#fff',
            border: 'none',
            padding: '0.5rem',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: isOffline ? 'not-allowed' : 'pointer'
          }}
        >
          {isCaching ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
          {isCaching ? 'Downloading Tiles...' : 'Cache Map Tiles for My Region'}
        </button>

        {cacheMsg && (
          <div style={{ fontSize: '0.78rem', color: cacheMsg.startsWith('✅') ? '#2e7d32' : '#c62828', background: cacheMsg.startsWith('✅') ? '#e8f5e9' : '#ffebee', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
            {cacheMsg}
          </div>
        )}
      </div>

    </div>
  )
}

