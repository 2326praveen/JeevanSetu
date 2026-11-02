import { useState, useEffect, useCallback } from 'react'
import { MapContainer, TileLayer, Popup, Polyline, Circle, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  ShieldCheck,
  AlertTriangle,
  Navigation,
  Clock,
  RefreshCw,
  PlusCircle,
  X,
  Zap,
  Waves,
  Trees,
  Ban,
  Camera
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { HazardReport, RouteResult, getSafeRoute } from '../utils/routing'
import DamageCaptureModal from './DamageCaptureModal'

// Default fallback hazards for offline or initial load
const DEFAULT_HAZARDS: HazardReport[] = [
  {
    id: 'h-1',
    hazard_type: 'flooded_road',
    severity: 4,
    lat: 12.9680,
    lng: 77.5850,
    description: 'K.R. Market Railway Underpass flooded with 3.5ft water.',
    avoid_radius_meters: 300,
    is_active: true
  },
  {
    id: 'h-2',
    hazard_type: 'fallen_tree',
    severity: 3,
    lat: 12.9420,
    lng: 77.6180,
    description: 'Uprooted tree blocking 80ft Road, Koramangala.',
    avoid_radius_meters: 150,
    is_active: true
  },
  {
    id: 'h-3',
    hazard_type: 'power_cable',
    severity: 5,
    lat: 12.9750,
    lng: 77.6020,
    description: 'Snapped live electrical transmission wire submerged in rainwater.',
    avoid_radius_meters: 200,
    is_active: true
  },
  {
    id: 'h-4',
    hazard_type: 'flooded_road',
    severity: 5,
    lat: 12.8640,
    lng: 74.8460,
    description: 'Netravati flash surge inundating Hampankatta main connector.',
    avoid_radius_meters: 350,
    is_active: true
  }
]

// Auto-fit map bounds helper
function MapBoundsFitter({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= 2) {
      const bounds = L.latLngBounds(points.map(p => L.latLng(p[0], p[1])))
      map.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [points, map])
  return null
}

interface SafeRouteMapProps {
  userLat: number
  userLng: number
  facility: {
    id: string
    name: string
    kind: string
    lat: number
    lng: number
    phone?: string
    address?: string
  }
  onClose?: () => void
}

export default function SafeRouteMap({ userLat, userLng, facility, onClose }: SafeRouteMapProps) {
  const [hazards, setHazards] = useState<HazardReport[]>(DEFAULT_HAZARDS)
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [avoidHazards, setAvoidHazards] = useState(true)
  const [showReportModal, setShowReportModal] = useState(false)
  const [showAiCameraModal, setShowAiCameraModal] = useState(false)

  // Quick hazard report form state
  const [newHazardType, setNewHazardType] = useState('flooded_road')
  const [newHazardDesc, setNewHazardDesc] = useState('')
  const [newHazardRadius, setNewHazardRadius] = useState(250)
  const [submittingHazard, setSubmittingHazard] = useState(false)

  // 1. Fetch live hazards from Supabase
  const loadHazards = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('hazard_reports')
        .select('*')
        .eq('is_active', true)

      if (!error && data && data.length > 0) {
        setHazards(data as HazardReport[])
      }
    } catch (e) {
      console.warn('Error loading hazards from Supabase, using defaults:', e)
    }
  }, [])

  // 2. Compute Safe Route
  const calculateRoute = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getSafeRoute(
        userLat,
        userLng,
        facility.lat,
        facility.lng,
        hazards,
        avoidHazards
      )
      setRoute(result)
    } finally {
      setLoading(false)
    }
  }, [userLat, userLng, facility.lat, facility.lng, hazards, avoidHazards])

  useEffect(() => {
    loadHazards()

    // Realtime subscription for crowd-reported hazards
    const channel = supabase
      .channel('hazard_reports_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hazard_reports' }, () => {
        loadHazards()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadHazards])

  useEffect(() => {
    calculateRoute()
  }, [calculateRoute])

  // Submit a new crowd hazard report
  const handleReportHazard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHazardDesc.trim()) return
    setSubmittingHazard(true)

    // Midpoint between user and facility as realistic report location
    const reportLat = (userLat + facility.lat) / 2
    const reportLng = (userLng + facility.lng) / 2

    const newReport: HazardReport = {
      id: `hz-${Date.now()}`,
      hazard_type: newHazardType,
      severity: 4,
      lat: reportLat,
      lng: reportLng,
      description: newHazardDesc.trim(),
      avoid_radius_meters: Number(newHazardRadius),
      is_active: true
    }

    try {
      await supabase.from('hazard_reports').insert({
        hazard_type: newReport.hazard_type,
        severity: newReport.severity,
        lat: newReport.lat,
        lng: newReport.lng,
        description: newReport.description,
        avoid_radius_meters: newReport.avoid_radius_meters,
        is_active: true
      })
    } catch (err) {
      console.warn('Could not persist to Supabase, adding to local state:', err)
    }

    setHazards(prev => [newReport, ...prev])
    setNewHazardDesc('')
    setShowReportModal(false)
    setSubmittingHazard(false)
  }

  const getHazardIcon = (type: string) => {
    switch (type) {
      case 'flooded_road': return <Waves size={16} />
      case 'power_cable': return <Zap size={16} />
      case 'fallen_tree': return <Trees size={16} />
      default: return <Ban size={16} />
    }
  }

  const boundsPoints: [number, number][] = [
    [userLat, userLng],
    [facility.lat, facility.lng],
    ...(route?.coordinates || [])
  ]

  return (
    <div className="safe-route-container" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#ffffff', borderRadius: '12px', padding: '1rem', border: '1.5px solid var(--border-color)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>

      {/* 1. Header Bar with Close Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#1565c0' }}>
            <Navigation size={18} />
            Safe Route to {facility.name}
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
            {facility.kind.toUpperCase()} • {facility.address || 'Designated Facility'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={calculateRoute}
            title="Recalculate route"
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.3rem 0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{ background: '#f5f5f5', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Safety Status & Route Metrics Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', background: route?.isSafe ? '#e8f5e9' : route?.detourApplied ? '#e3f2fd' : '#ffebee', padding: '0.65rem 0.85rem', borderRadius: '8px', borderLeft: `4px solid ${route?.isSafe ? '#2e7d32' : route?.detourApplied ? '#1976d2' : '#c62828'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 700 }}>
          {route?.isSafe ? (
            <>
              <ShieldCheck size={18} color="#2e7d32" />
              <span style={{ color: '#2e7d32' }}>CLEAR SAFE ROUTE (0 HAZARDS)</span>
            </>
          ) : route?.detourApplied ? (
            <>
              <ShieldCheck size={18} color="#1976d2" />
              <span style={{ color: '#1565c0' }}>SAFE DETOUR APPLIED (BYPASSING HAZARD)</span>
            </>
          ) : (
            <>
              <AlertTriangle size={18} color="#c62828" />
              <span style={{ color: '#c62828' }}>
                ⚠️ {route?.hazardsOnRoute.length} HAZARD(S) ON PATH
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem', color: '#333' }}>
          <span><strong>{route?.distanceKm || 0} km</strong></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <Clock size={14} /> ~{route?.durationMin || 0} mins
          </span>
        </div>
      </div>

      {/* Warning Alert Banner when hazards intersect */}
      {route && !route.isSafe && (
        <div style={{ backgroundColor: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#e65100', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {route.hazardsOnRoute.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ display: 'flex', alignItems: 'center' }}>{getHazardIcon(h.hazard_type)}</span>
              <span>
                <strong>{h.hazard_type.replace('_', ' ').toUpperCase()}:</strong> {h.description} (Avoid Radius: {h.avoid_radius_meters}m)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 3. Interactive Leaflet Map with OSRM Polyline & Hazard Circles */}
      <div style={{ height: '340px', width: '100%', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
        <MapContainer
          center={[userLat, userLng]}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors | OSRM Safe Routing"
          />

          <MapBoundsFitter points={boundsPoints} />

          {/* User Starting Point Marker */}
          <Circle
            center={[userLat, userLng]}
            radius={35}
            pathOptions={{ color: '#1976d2', fillColor: '#2196f3', fillOpacity: 0.9, weight: 3 }}
          >
            <Tooltip permanent direction="top" offset={[0, -5]}>
              📍 Your Location
            </Tooltip>
            <Popup>
              <strong>Your SOS Origin</strong><br />
              Lat: {userLat.toFixed(4)}, Lng: {userLng.toFixed(4)}
            </Popup>
          </Circle>

          {/* Target Facility Destination Marker */}
          <Circle
            center={[facility.lat, facility.lng]}
            radius={45}
            pathOptions={{ color: '#7b1fa2', fillColor: '#9c27b0', fillOpacity: 0.9, weight: 3 }}
          >
            <Tooltip permanent direction="top" offset={[0, -5]}>
              🏢 {facility.name}
            </Tooltip>
            <Popup>
              <strong>{facility.name}</strong><br />
              Type: {facility.kind}<br />
              Phone: {facility.phone || 'N/A'}<br />
              {facility.address}
            </Popup>
          </Circle>

          {/* OSRM Route Polyline */}
          {route && route.coordinates.length > 0 && (
            <Polyline
              positions={route.coordinates}
              pathOptions={{
                color: route.isSafe ? '#2e7d32' : route.detourApplied ? '#1976d2' : '#d32f2f',
                weight: 5,
                opacity: 0.85,
                dashArray: route.isSafe ? undefined : '6, 6'
              }}
            />
          )}

          {/* Active Hazard Warning Circles */}
          {hazards.map((h) => (
            <Circle
              key={h.id}
              center={[h.lat, h.lng]}
              radius={h.avoid_radius_meters}
              pathOptions={{
                color: '#d32f2f',
                fillColor: '#ef5350',
                fillOpacity: 0.35,
                weight: 2,
                dashArray: '4, 4'
              }}
            >
              <Tooltip direction="top">
                ⚠️ {h.hazard_type.replace('_', ' ').toUpperCase()} ({h.avoid_radius_meters}m danger zone)
              </Tooltip>
              <Popup>
                <div>
                  <strong style={{ color: '#c62828' }}>
                    [{h.hazard_type.replace('_', ' ').toUpperCase()}]
                  </strong><br />
                  {h.description}<br />
                  <small>Avoid Radius: {h.avoid_radius_meters} meters</small>
                </div>
              </Popup>
            </Circle>
          ))}
        </MapContainer>
      </div>

      {/* 4. Controls: Detour Toggle & Report Hazard Trigger */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.25rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#444', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={avoidHazards}
            onChange={(e) => setAvoidHazards(e.target.checked)}
          />
          <span>Auto-Detour around active hazards</span>
        </label>

        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button
            onClick={() => setShowAiCameraModal(true)}
            style={{
              background: '#e3f2fd',
              color: '#0d47a1',
              border: '1px solid #90caf9',
              padding: '0.35rem 0.65rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            <Camera size={14} />
            AI Damage Scan
          </button>
          <button
            onClick={() => setShowReportModal(true)}
            style={{
              background: '#fff3e0',
              color: '#e65100',
              border: '1px solid #ffb74d',
              padding: '0.35rem 0.65rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            <PlusCircle size={14} />
            Report Hazard
          </button>
        </div>
      </div>

      {/* 5. Crowd Hazard Report Modal */}
      {showReportModal && (
        <div style={{ background: '#f5f5f5', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.85rem' }}>Report Blocked Road or Hazard</strong>
            <button onClick={() => setShowReportModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleReportHazard} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>Hazard Type:</label>
              <select
                aria-label="Hazard Type"
                value={newHazardType}
                onChange={(e) => setNewHazardType(e.target.value)}
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
              >
                <option value="flooded_road">🌊 Flooded Road / Waterlogging</option>
                <option value="blocked_path">🚧 Road Block / Mud / Debris</option>
                <option value="collapsed_bridge">🌉 Bridge / Culvert Collapse</option>
                <option value="fallen_tree">🌳 Fallen Tree</option>
                <option value="power_cable">⚡ Live Electrical Wire Submerged</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>Description & Landmark:</label>
              <input
                type="text"
                placeholder="e.g. Water 3ft deep under railway underpass"
                value={newHazardDesc}
                onChange={(e) => setNewHazardDesc(e.target.value)}
                required
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>Avoid Danger Radius:</label>
              <select
                aria-label="Avoid Danger Radius"
                value={newHazardRadius}
                onChange={(e) => setNewHazardRadius(Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
              >
                <option value={150}>150 meters (Small obstacle)</option>
                <option value={250}>250 meters (Standard street blockage)</option>
                <option value={400}>400 meters (Major flooding/collapse)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={submittingHazard}
              style={{
                backgroundColor: 'var(--primary-color)',
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
              {submittingHazard ? 'Publishing Hazard...' : 'Broadcast Hazard Alert'}
            </button>
          </form>
        </div>
      )}

      {/* 6. AI Damage Capture & Vision Analysis Modal */}
      {showAiCameraModal && (
        <DamageCaptureModal
          userLat={userLat}
          userLng={userLng}
          onClose={() => setShowAiCameraModal(false)}
          onHazardCreated={(newHz) => {
            setHazards(prev => [newHz, ...prev])
            setShowAiCameraModal(false)
            calculateRoute()
          }}
        />
      )}
    </div>
  )
}
