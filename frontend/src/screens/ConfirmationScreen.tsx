import { useLocation, useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { CheckCircle, AlertTriangle, ArrowLeft, Navigation } from 'lucide-react'
import SafeRouteMap from '../components/SafeRouteMap'

export default function ConfirmationScreen() {
  const { ticketId } = useParams()
  const location = useLocation()
  const initialData = location.state?.data
  
  const [status, setStatus] = useState(initialData?.ticket?.status || 'new')
  const [selectedFacilityForRoute, setSelectedFacilityForRoute] = useState<any>(
    initialData?.nearby_facilities?.[0] || null
  )
  
  useEffect(() => {
    if (!ticketId) return;
    
    // Subscribe to realtime status updates for this ticket
    const channel = supabase
      .channel(`public:tickets:id=eq.${ticketId}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'tickets', 
        filter: `id=eq.${ticketId}` 
      }, (payload) => {
        if (payload.new.status) {
          setStatus(payload.new.status)
        }
      })
      .subscribe()
      
    return () => {
      supabase.removeChannel(channel)
    }
  }, [ticketId])

  if (!initialData) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>No data found.</div>
  }

  const { triage, nearby_facilities } = initialData

  const getStatusText = (s: string) => {
    switch(s) {
      case 'new': return 'Received by Central Control';
      case 'assigned': return 'Assigned to Rescue Team';
      case 'in_progress': return 'Rescue Team En Route';
      case 'resolved': return 'Emergency Resolved';
      default: return 'Pending';
    }
  }

  const steps = ['new', 'assigned', 'in_progress', 'resolved'];
  const currentIndex = steps.indexOf(status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-light)', textDecoration: 'none' }}>
        <ArrowLeft size={16} /> Back to SOS
      </Link>
      
      <div style={{ textAlign: 'center' }}>
        <CheckCircle size={64} color="var(--success-color)" style={{ margin: '0 auto 1rem auto' }} />
        <h2>SOS Sent Successfully</h2>
        <p style={{ marginTop: '0.5rem', fontSize: '1.1rem', fontWeight: 'bold' }}>
          {triage.reply_in_user_language || triage.english_summary}
        </p>
      </div>

      <div className="status-tracker">
        <h3>Live Status</h3>
        <div style={{ marginTop: '1rem' }}>
          {steps.map((step, idx) => (
            <div key={step} className={`status-step ${idx === currentIndex ? 'active' : ''} ${idx < currentIndex ? 'completed' : ''}`}>
              <div style={{ 
                width: '16px', height: '16px', borderRadius: '50%', 
                backgroundColor: idx <= currentIndex ? 'var(--primary-color)' : 'var(--border-color)',
                flexShrink: 0
              }}></div>
              <span>{getStatusText(step)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Safe Evacuation Route (Phase 3) */}
      {selectedFacilityForRoute && (
        <SafeRouteMap
          userLat={initialData?.ticket?.lat || 12.9716}
          userLng={initialData?.ticket?.lng || 77.5946}
          facility={selectedFacilityForRoute}
          onClose={() => setSelectedFacilityForRoute(null)}
        />
      )}

      {nearby_facilities && nearby_facilities.length > 0 && (
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <AlertTriangle size={20} color="var(--warning-color)" />
            Nearest Relief Centers & Safe Evacuation
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginBottom: '0.75rem' }}>
            Select any facility below to compute an OSRM safe route avoiding blocked roads and flood zones:
          </p>
          {nearby_facilities.map((fac: any) => {
            const isSelected = selectedFacilityForRoute?.id === fac.id
            return (
              <div 
                key={fac.id} 
                className="facility-card"
                style={{
                  border: isSelected ? '2px solid var(--secondary-color)' : '1px solid var(--border-color)',
                  backgroundColor: isSelected ? '#f0f7ff' : '#fafafa',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h4>{fac.name} <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-light)' }}>({fac.kind})</span></h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                      {fac.address}
                    </p>
                    <p style={{ fontSize: '0.85rem', marginTop: '0.25rem', color: '#333' }}>
                      Distance: <strong>{fac.distance_km} km</strong> | Phone: {fac.phone || 'N/A'}
                    </p>
                  </div>

                  <button
                    onClick={() => setSelectedFacilityForRoute(fac)}
                    style={{
                      backgroundColor: isSelected ? 'var(--secondary-color)' : '#ffffff',
                      color: isSelected ? '#ffffff' : 'var(--secondary-color)',
                      border: '1.5px solid var(--secondary-color)',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    <Navigation size={14} />
                    {isSelected ? 'Viewing Safe Route' : 'Show Route'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
