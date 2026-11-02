import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { Navigation, Building2 } from 'lucide-react'
import SafeRouteMap from '../components/SafeRouteMap'

interface FacilityItem {
  id: string
  name: string
  kind: 'shelter' | 'hospital' | 'relief_center' | string
  lat: number
  lng: number
  capacity?: number
  occupancy?: number
  phone?: string
  address?: string
  distance_km?: number
}

const DEFAULT_FACILITIES: FacilityItem[] = [
  {
    id: 'f-1',
    name: 'Kanteerava Stadium Mega Shelter',
    kind: 'shelter',
    lat: 12.9698,
    lng: 77.5926,
    phone: '+91-80-22271888',
    address: 'Kasturba Road, Sampangi Rama Nagara, Bengaluru',
    distance_km: 1.2
  },
  {
    id: 'f-2',
    name: 'Victoria Hospital - Emergency Trauma Care',
    kind: 'hospital',
    lat: 12.9634,
    lng: 77.5744,
    phone: '+91-80-26701150',
    address: 'Fort Road, near City Market, Bengaluru',
    distance_km: 2.1
  },
  {
    id: 'f-3',
    name: 'Hebbal Flood Relief & Supply Depot',
    kind: 'relief_center',
    lat: 13.0358,
    lng: 77.5970,
    phone: '+91-80-22975800',
    address: 'Bellary Road, Hebbal Flyover Junction, Bengaluru',
    distance_km: 4.8
  }
]

export default function SafetyGuidanceScreen() {
  const [facilities, setFacilities] = useState<FacilityItem[]>(DEFAULT_FACILITIES)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number }>({ lat: 12.9716, lng: 77.5946 })
  const [activeFacility, setActiveFacility] = useState<FacilityItem | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('all')

  useEffect(() => {
    // Attempt GPS detection
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setUserLocation(loc)
          loadNearestFacilities(loc.lat, loc.lng)
        },
        () => loadNearestFacilities(12.9716, 77.5946),
        { timeout: 4000 }
      )
    } else {
      loadNearestFacilities(12.9716, 77.5946)
    }
  }, [])

  const loadNearestFacilities = async (lat: number, lng: number) => {
    try {
      const { data, error } = await supabase.rpc('nearest_facilities', {
        user_lat: lat,
        user_lng: lng,
        facility_type: null,
        max_results: 6
      })

      if (!error && data && data.length > 0) {
        setFacilities(data as FacilityItem[])
      } else {
        // Query direct table if RPC is initializing
        const { data: directData } = await supabase.from('facilities').select('*').limit(6)
        if (directData && directData.length > 0) {
          setFacilities(directData as FacilityItem[])
        }
      }
    } catch (e) {
      console.warn('Facility lookup error, using default seed:', e)
    }
  }

  const filteredFacilities = kindFilter === 'all'
    ? facilities
    : facilities.filter(f => f.kind === kindFilter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* 1. Safe Evacuation Map Modal / In-line viewer */}
      {activeFacility && (
        <SafeRouteMap
          userLat={userLocation.lat}
          userLng={userLocation.lng}
          facility={activeFacility}
          onClose={() => setActiveFacility(null)}
        />
      )}

      {/* 2. Nearest Relief Facilities & Safe Routing Section */}
      <div style={{ background: '#ffffff', borderRadius: '12px', padding: '1rem', border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#1565c0' }}>
              <Building2 size={18} />
              Nearest Designated Relief Facilities
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
              Live GPS routing via OSRM with crowd hazard bypass
            </span>
          </div>

          {/* Category Filter Pills */}
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {['all', 'shelter', 'hospital', 'relief_center'].map((kind) => (
              <button
                key={kind}
                onClick={() => setKindFilter(kind)}
                style={{
                  background: kindFilter === kind ? 'var(--secondary-color)' : '#f0f4f8',
                  color: kindFilter === kind ? '#ffffff' : '#333333',
                  border: 'none',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '16px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize'
                }}
              >
                {kind.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Facilities List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {filteredFacilities.map((fac) => (
            <div
              key={fac.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                padding: '0.75rem',
                background: '#f9f9f9',
                borderRadius: '8px',
                border: '1px solid #e0e0e0'
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#222' }}>
                  {fac.kind === 'hospital' ? '🏥 ' : fac.kind === 'shelter' ? '⛺ ' : '📦 '}
                  {fac.name}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '0.15rem' }}>
                  {fac.address || 'Karnataka'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#555', marginTop: '0.25rem' }}>
                  {fac.distance_km ? `Distance: ~${fac.distance_km} km` : 'Near your sector'} | Phone: {fac.phone || 'N/A'}
                </div>
              </div>

              <button
                onClick={() => setActiveFacility(fac)}
                style={{
                  backgroundColor: 'var(--secondary-color)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
              >
                <Navigation size={14} />
                Safe Route
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Offline Disaster Survival Guidance */}
      <div>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Disaster Safety Guidance (Offline Available)</h2>
        <p style={{ color: 'var(--text-light)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Essential survival protocols cached locally on device for zero-connectivity situations.
        </p>
        
        <div className="guidance-card">
          <h3 style={{ color: '#1565c0' }}>🌊 Flood & Waterlogging Protocol</h3>
          <ul>
            <li>Move to higher ground immediately. Never walk through moving floodwater.</li>
            <li>Six inches of moving water can knock down an adult; two feet can sweep away an automobile.</li>
            <li>Switch off electric supply mains and disconnect appliances before water reaches floor level.</li>
            <li>Do not drink municipal tap water until boiled or verified safe; use bottled emergency water.</li>
          </ul>
        </div>

        <div className="guidance-card">
          <h3 style={{ color: '#c62828' }}>🌀 Cyclone & High Winds Protocol</h3>
          <ul>
            <li>Stay indoors away from exposed glass windows and unreinforced brick walls.</li>
            <li>Secure or latch all exterior doors and store outdoor loose furniture and tin sheets.</li>
            <li>Keep emergency battery-powered transistor radios tuned to All India Radio or NDMA alerts.</li>
            <li>If eye of the cyclone passes overhead, do not go outside — winds will violently reverse within minutes.</li>
          </ul>
        </div>

        <div className="guidance-card">
          <h3 style={{ color: '#e65100' }}>⛰️ Landslide & Slope Movement Protocol</h3>
          <ul>
            <li>Avoid traveling during continuous heavy rains along mountain passes and Western Ghats ghat roads.</li>
            <li>Watch for early signs: fresh ground cracks, muddy hillside springs, tilting trees or poles.</li>
            <li>If trapped, curl into a tight ball protecting head with arms to minimize impact from debris.</li>
          </ul>
        </div>

        <div className="guidance-card">
          <h3 style={{ color: '#388e3c' }}>🔥 Electrical & Urban Fire Protocol</h3>
          <ul>
            <li>Crawl low under smoke toward exits; cleaner air remains near the floor.</li>
            <li>Feel closed doors with the back of your hand before turning handles. If hot, use alternate exit.</li>
            <li>Never use elevators during fires or power outages; use fire escape stairwells.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
