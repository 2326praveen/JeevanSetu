import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { 
  AlertTriangle, 
  ShieldAlert, 
  ShieldCheck, 
  CheckSquare, 
  Square, 
  ChevronDown, 
  ChevronUp, 
  RefreshCw, 
  Waves, 
  Wind, 
  Mountain, 
  SunMedium, 
  Activity,
  Sparkles
} from 'lucide-react'

export interface RiskForecast {
  id: string
  region: string
  lat: number
  lng: number
  hazard: 'flood' | 'cyclone' | 'landslide' | 'heatwave' | 'earthquake' | string
  score: number
  level: 'low' | 'moderate' | 'high' | 'critical'
  advisory: string
  checklist: string[]
  metrics?: {
    precipitation_mm?: number
    river_discharge_m3s?: number
    wind_speed_kmh?: number
    max_temp_c?: number
    recent_quakes?: number
  }
  valid_until?: string
  distance_km?: number
}

// Fallback demo forecasts when database or network is initializing
const DEFAULT_FORECASTS: RiskForecast[] = [
  {
    id: 'demo-1',
    region: 'Dakshina Kannada (Mangaluru)',
    lat: 12.9141,
    lng: 74.8560,
    hazard: 'flood',
    score: 78,
    level: 'high',
    advisory: 'Severe coastal rainfall exceeding 72mm and surging river runoff detected in Netravati catchment. Low-lying riparian zones and coastal habitations face imminent waterlogging.',
    metrics: { precipitation_mm: 72.4, river_discharge_m3s: 380, wind_speed_kmh: 48, max_temp_c: 29.5 },
    checklist: [
      'Store 3 days potable water and non-perishable rations',
      'Elevate electrical appliances and disconnect grounded mains',
      'Secure vital identity documents in watertight pouches',
      'Identify your nearest safe shelter (Govt PU College or Relief Hall)'
    ]
  },
  {
    id: 'demo-2',
    region: 'Bengaluru Urban',
    lat: 12.9716,
    lng: 77.5946,
    hazard: 'flood',
    score: 42,
    level: 'moderate',
    advisory: 'Moderate convective evening showers anticipated with storm drain bottlenecks in eastern corridors. Risk of localized road flooding in underpasses.',
    metrics: { precipitation_mm: 28.5, river_discharge_m3s: 42, wind_speed_kmh: 24, max_temp_c: 31.0 },
    checklist: [
      'Avoid transit through known flooded underpasses during storm',
      'Check perimeter drainage around ground-floor entrances',
      'Charge mobile phones and powerbanks before expected downpour'
    ]
  },
  {
    id: 'demo-3',
    region: 'Uttara Kannada (Karwar)',
    lat: 14.8185,
    lng: 74.1350,
    hazard: 'landslide',
    score: 74,
    level: 'high',
    advisory: 'Saturated Western Ghats soil layers following 88mm continuous precipitation. Elevated risk of debris flow and rockslides along ghat corridors and NH-66.',
    metrics: { precipitation_mm: 88.0, river_discharge_m3s: 210, wind_speed_kmh: 36, max_temp_c: 27.5 },
    checklist: [
      'Avoid non-essential transit across steep mountain ghat roads',
      'Inspect hillsides for new surface cracks, tilted trees, or muddy seepages',
      'Evacuate immediately if rumbling sounds or slope movement occur'
    ]
  },
  {
    id: 'demo-4',
    region: 'Puri / Coastal Odisha',
    lat: 19.8135,
    lng: 85.8312,
    hazard: 'cyclone',
    score: 86,
    level: 'critical',
    advisory: 'Severe cyclonic storm system advancing through Bay of Bengal with sustained wind gusts of 86 km/h and coastal tidal surge warnings.',
    metrics: { precipitation_mm: 115.0, river_discharge_m3s: 520, wind_speed_kmh: 86, max_temp_c: 27.0 },
    checklist: [
      'Follow coastal evacuation directives to designated cyclone shelters immediately',
      'Board up or latch all glass windows and secure loose rooftop items',
      'Keep battery-powered radio and emergency lighting at hand',
      'Do not venture into open sea or coastal beaches under any circumstance'
    ]
  },
  {
    id: 'demo-5',
    region: 'Delhi NCR',
    lat: 28.6139,
    lng: 77.2090,
    hazard: 'heatwave',
    score: 68,
    level: 'high',
    advisory: 'Severe heatwave conditions with peak afternoon temperatures touching 43.8°C and low humidity. High risk of dehydration and heat exhaustion.',
    metrics: { precipitation_mm: 0.0, river_discharge_m3s: 12, wind_speed_kmh: 16, max_temp_c: 43.8 },
    checklist: [
      'Avoid direct outdoor sun exposure between 11:30 AM and 4:30 PM',
      'Drink water and ORS/coconut water frequently even if not feeling thirsty',
      'Ensure shaded quarters and hydration for children, elderly, and pets'
    ]
  }
]

export default function RiskCard({ userLat, userLng }: { userLat?: number | null; userLng?: number | null }) {
  const [forecasts, setForecasts] = useState<RiskForecast[]>(DEFAULT_FORECASTS)
  const [selectedForecast, setSelectedForecast] = useState<RiskForecast>(DEFAULT_FORECASTS[0])
  const [completedItems, setCompletedItems] = useState<Record<string, boolean>>({})
  const [showDetails, setShowDetails] = useState(false)
  const [loading, setLoading] = useState(false)

  // Fetch live forecasts from Supabase or fallback
  const loadForecasts = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('risk_forecasts')
        .select('*')
        .order('score', { ascending: false })

      if (!error && data && data.length > 0) {
        setForecasts(data as RiskForecast[])
        // Auto-select nearest or highest severity
        if (userLat && userLng) {
          const nearest = findNearest(data, userLat, userLng)
          if (nearest) setSelectedForecast(nearest)
        } else {
          setSelectedForecast(data[0] as RiskForecast)
        }
      }
    } catch (e) {
      console.warn('Error loading risk forecasts from Supabase:', e)
    } finally {
      setLoading(false)
    }
  }

  // Haversine distance helper for client side matching
  const findNearest = (items: any[], lat: number, lng: number): RiskForecast => {
    let closest = items[0]
    let minD = Infinity
    for (const item of items) {
      const d = 6371 * Math.acos(
        Math.min(1.0, Math.max(-1.0,
          Math.cos(lat * Math.PI / 180) * Math.cos(item.lat * Math.PI / 180) *
          Math.cos((item.lng - lng) * Math.PI / 180) +
          Math.sin(lat * Math.PI / 180) * Math.sin(item.lat * Math.PI / 180)
        ))
      )
      if (d < minD) {
        minD = d
        closest = { ...item, distance_km: Math.round(d) }
      }
    }
    return closest
  }

  useEffect(() => {
    loadForecasts()

    // Subscribe to realtime risk forecast updates
    const channel = supabase
      .channel('risk-forecasts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'risk_forecasts' }, () => {
        loadForecasts()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userLat, userLng])

  const toggleCheck = (idx: number) => {
    const key = `${selectedForecast.id}-${idx}`
    setCompletedItems(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const getHazardIcon = (hazard: string) => {
    switch (hazard.toLowerCase()) {
      case 'flood': return <Waves size={20} />
      case 'cyclone': return <Wind size={20} />
      case 'landslide': return <Mountain size={20} />
      case 'heatwave': return <SunMedium size={20} />
      case 'earthquake': return <Activity size={20} />
      default: return <AlertTriangle size={20} />
    }
  }

  const getLevelTheme = (level: string) => {
    switch (level) {
      case 'critical':
        return {
          bg: '#ffebee',
          border: '#d32f2f',
          text: '#b71c1c',
          badgeBg: '#d32f2f',
          badgeText: '#ffffff'
        }
      case 'high':
        return {
          bg: '#fff3e0',
          border: '#f57c00',
          text: '#e65100',
          badgeBg: '#f57c00',
          badgeText: '#ffffff'
        }
      case 'moderate':
        return {
          bg: '#fffde7',
          border: '#fbc02d',
          text: '#f57f17',
          badgeBg: '#fbc02d',
          badgeText: '#000000'
        }
      default:
        return {
          bg: '#e8f5e9',
          border: '#43a047',
          text: '#2e7d32',
          badgeBg: '#43a047',
          badgeText: '#ffffff'
        }
    }
  }

  const theme = getLevelTheme(selectedForecast.level)
  const checklist = selectedForecast.checklist || []
  const completedCount = checklist.filter((_, idx) => completedItems[`${selectedForecast.id}-${idx}`]).length

  return (
    <div 
      className="risk-card"
      style={{
        backgroundColor: theme.bg,
        border: `1.5px solid ${theme.border}`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
      }}
    >
      {/* 1. Header with Region selector & Severity Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: theme.text, fontWeight: 700, fontSize: '0.95rem' }}>
            {selectedForecast.level === 'critical' ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}
            <span>DISASTER RISK OUTLOOK</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.85 }}>
              (Open-Meteo + AI)
            </span>
          </div>

          <div style={{ marginTop: '0.25rem' }}>
            <select
              aria-label="Select disaster risk region"
              value={selectedForecast.region}
              onChange={(e) => {
                const found = forecasts.find(f => f.region === e.target.value)
                if (found) setSelectedForecast(found)
              }}
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#222',
                padding: '0.25rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid rgba(0,0,0,0.15)',
                backgroundColor: '#ffffff',
                cursor: 'pointer'
              }}
            >
              {forecasts.map(f => (
                <option key={f.region} value={f.region}>
                  📍 {f.region} ({f.hazard.toUpperCase()} - {f.score}/100)
                </option>
              ))}
            </select>
            {selectedForecast.distance_km !== undefined && (
              <span style={{ fontSize: '0.75rem', color: '#555', marginLeft: '0.5rem' }}>
                ~{selectedForecast.distance_km} km away
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            onClick={loadForecasts}
            title="Refresh weather & risk feeds"
            style={{
              background: 'none',
              border: 'none',
              color: theme.text,
              cursor: 'pointer',
              padding: '0.2rem',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <span 
            style={{
              backgroundColor: theme.badgeBg,
              color: theme.badgeText,
              padding: '0.25rem 0.65rem',
              borderRadius: '20px',
              fontSize: '0.75rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            {getHazardIcon(selectedForecast.hazard)}
            {selectedForecast.level} • {selectedForecast.score}/100
          </span>
        </div>
      </div>

      {/* 2. AI Location-Specific Advisory */}
      <div 
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '0.75rem',
          borderLeft: `4px solid ${theme.border}`,
          marginBottom: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--secondary-color)', fontWeight: 700, marginBottom: '0.25rem' }}>
          <Sparkles size={14} />
          <span>GROQ AI LOCAL ADVISORY</span>
        </div>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#222', lineHeight: '1.45' }}>
          {selectedForecast.advisory}
        </p>
      </div>

      {/* 3. Live Telemetry Metrics Pills */}
      {selectedForecast.metrics && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
          {selectedForecast.metrics.precipitation_mm !== undefined && (
            <span style={{ backgroundColor: 'rgba(255,255,255,0.8)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.08)' }}>
              🌧️ Rain: <strong>{selectedForecast.metrics.precipitation_mm}mm</strong>
            </span>
          )}
          {selectedForecast.metrics.river_discharge_m3s !== undefined && (
            <span style={{ backgroundColor: 'rgba(255,255,255,0.8)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.08)' }}>
              🌊 River Flow: <strong>{selectedForecast.metrics.river_discharge_m3s} m³/s</strong>
            </span>
          )}
          {selectedForecast.metrics.wind_speed_kmh !== undefined && (
            <span style={{ backgroundColor: 'rgba(255,255,255,0.8)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.08)' }}>
              💨 Wind: <strong>{selectedForecast.metrics.wind_speed_kmh} km/h</strong>
            </span>
          )}
          {selectedForecast.metrics.max_temp_c !== undefined && (
            <span style={{ backgroundColor: 'rgba(255,255,255,0.8)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.08)' }}>
              🌡️ Max Temp: <strong>{selectedForecast.metrics.max_temp_c}°C</strong>
            </span>
          )}
        </div>
      )}

      {/* 4. Preparedness Checklist Accordion */}
      <div style={{ backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: '8px', padding: '0.6rem 0.75rem', border: '1px solid rgba(0,0,0,0.06)' }}>
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{
            background: 'none',
            border: 'none',
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            padding: 0,
            color: '#222',
            fontWeight: 700,
            fontSize: '0.82rem'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ShieldCheck size={16} color={theme.text} />
            <span>Community Preparedness Checklist</span>
            <span style={{ fontSize: '0.75rem', color: '#666', fontWeight: 500 }}>
              ({completedCount}/{checklist.length} ready)
            </span>
          </span>
          {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showDetails && (
          <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {checklist.map((item, idx) => {
              const isChecked = !!completedItems[`${selectedForecast.id}-${idx}`]
              return (
                <div
                  key={idx}
                  onClick={() => toggleCheck(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    color: isChecked ? '#777' : '#222',
                    textDecoration: isChecked ? 'line-through' : 'none'
                  }}
                >
                  <span style={{ color: isChecked ? 'var(--success-color)' : theme.text, marginTop: '2px' }}>
                    {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </span>
                  <span style={{ lineHeight: '1.4' }}>{item}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

