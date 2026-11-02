import { useState } from 'react'
import {
  Sparkles,
  Truck,
  CheckCircle2,
  Building,
  Navigation,
  Clock,
  Check,
  RefreshCw,
  ShieldAlert,
  ArrowRight
} from 'lucide-react'
import { Ticket, RescueTeam, Facility } from '../screens/AdminScreen'
import {
  AssignmentSuggestion,
  StagingPosition,
  ShelterAnalysis,
  computeOptimizedAssignments,
  detectAmbulanceStagingHubs,
  analyzeShelterOccupancy
} from '../utils/optimizer'
import { supabase } from '../supabaseClient'

interface RescueOptimizerPanelProps {
  tickets: Ticket[]
  rescueTeams: RescueTeam[]
  facilities: Facility[]
  onRefreshData: () => Promise<void>
  onFocusCoordinates?: (lat: number, lng: number) => void
}

export default function RescueOptimizerPanel({
  tickets,
  rescueTeams,
  facilities,
  onRefreshData,
  onFocusCoordinates
}: RescueOptimizerPanelProps) {
  const [activeTab, setActiveTab] = useState<'assignments' | 'staging' | 'shelters'>('assignments')
  const [isAcceptingAll, setIsAcceptingAll] = useState(false)
  const [acceptedBatchMsg, setAcceptedBatchMsg] = useState<string | null>(null)
  const [acceptingTeamId, setAcceptingTeamId] = useState<string | null>(null)

  // 1. Calculate dynamic suggestions and metrics
  const suggestions: AssignmentSuggestion[] = computeOptimizedAssignments(tickets, rescueTeams)
  const stagingHubs: StagingPosition[] = detectAmbulanceStagingHubs(tickets, facilities)
  const shelterMetrics: ShelterAnalysis[] = analyzeShelterOccupancy(facilities)

  const unassignedCount = tickets.filter(t => t.status === 'new' && !t.assigned_team_id).length
  const availableTeamsCount = rescueTeams.filter(t => t.available).length
  const overcrowdedShelters = shelterMetrics.filter(s => s.status === 'critical')

  // Accept a single suggestion
  const handleAcceptSingle = async (suggestion: AssignmentSuggestion) => {
    setAcceptingTeamId(suggestion.teamId)
    setAcceptedBatchMsg(null)
    try {
      // 1. Assign ticket
      const { error: ticketErr } = await supabase
        .from('tickets')
        .update({
          assigned_team_id: suggestion.teamId,
          status: 'assigned',
          updated_at: new Date().toISOString()
        })
        .eq('id', suggestion.ticketId)

      if (ticketErr) throw ticketErr

      // 2. Mark team unavailable
      const { error: teamErr } = await supabase
        .from('rescue_teams')
        .update({ available: false })
        .eq('id', suggestion.teamId)

      if (teamErr) throw teamErr

      await onRefreshData()
      setAcceptedBatchMsg(`Unit "${suggestion.teamName}" successfully dispatched to Ticket #${suggestion.ticketId.slice(0, 6)}!`)
    } catch (err: any) {
      console.error('Failed to accept single match:', err)
      setAcceptedBatchMsg(`Dispatch error: ${err.message}`)
    } finally {
      setAcceptingTeamId(null)
    }
  }

  // Accept all suggestions in one click (Greedy Batch Dispatch)
  const handleAcceptAll = async () => {
    if (suggestions.length === 0) return
    setIsAcceptingAll(true)
    setAcceptedBatchMsg(null)

    try {
      const payload = suggestions.map(s => ({
        ticket_id: s.ticketId,
        team_id: s.teamId
      }))

      // Try RPC first
      const { data, error } = await supabase.rpc('batch_assign_teams', {
        assignments: payload
      })

      if (error) {
        // Fallback: Client-side loop for resilient demo operation
        console.warn('RPC batch_assign_teams unavailable, running client batch:', error)
        for (const s of suggestions) {
          await supabase.from('tickets').update({
            assigned_team_id: s.teamId,
            status: 'assigned',
            updated_at: new Date().toISOString()
          }).eq('id', s.ticketId)

          await supabase.from('rescue_teams').update({
            available: false
          }).eq('id', s.teamId)
        }
      }

      await onRefreshData()
      const count = data?.assigned_count || suggestions.length
      setAcceptedBatchMsg(`⚡ One-Click Optimization Complete: Dispatched ${count} rescue teams to highest-priority distress calls!`)
    } catch (err: any) {
      console.error('Failed to batch accept suggestions:', err)
      setAcceptedBatchMsg(`Batch dispatch error: ${err.message}`)
    } finally {
      setIsAcceptingAll(false)
    }
  }

  // Adjust shelter occupancy
  const handleAdjustShelter = async (facilityId: string, delta: number) => {
    try {
      const fac = facilities.find(f => f.id === facilityId)
      if (!fac) return
      const newOcc = Math.max(0, (fac.occupancy || 0) + delta)

      await supabase
        .from('facilities')
        .update({ occupancy: newOcc })
        .eq('id', facilityId)

      await onRefreshData()
    } catch (err) {
      console.error('Error adjusting shelter occupancy:', err)
    }
  }

  return (
    <div style={{ background: '#ffffff', borderRadius: '10px', padding: '1rem', border: '1.5px solid #bbdefb', boxShadow: '0 4px 16px rgba(13, 71, 161, 0.08)', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      
      {/* 1. Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid #e3f2fd', paddingBottom: '0.75rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#0d47a1' }}>
            <Sparkles size={18} color="#1976d2" />
            Rescue Resource Optimizer
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
            AI Multi-Factor Priority Scoring, Greedy Fleet Dispatch & Shelter Balancing
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', background: '#e3f2fd', color: '#0d47a1', padding: '0.25rem 0.55rem', borderRadius: '12px', fontWeight: 600 }}>
            {unassignedCount} Unassigned
          </span>
          <span style={{ fontSize: '0.75rem', background: '#e8f5e9', color: '#2e7d32', padding: '0.25rem 0.55rem', borderRadius: '12px', fontWeight: 600 }}>
            {availableTeamsCount} Units Ready
          </span>
          {overcrowdedShelters.length > 0 && (
            <span style={{ fontSize: '0.75rem', background: '#ffebee', color: '#c62828', padding: '0.25rem 0.55rem', borderRadius: '12px', fontWeight: 700 }}>
              ⚠️ {overcrowdedShelters.length} Overcrowded Shelter
            </span>
          )}
        </div>
      </div>

      {/* Notification Banner */}
      {acceptedBatchMsg && (
        <div style={{ padding: '0.5rem 0.75rem', background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: '6px', fontSize: '0.8rem', color: '#2e7d32', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{acceptedBatchMsg}</span>
          <button onClick={() => setAcceptedBatchMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2e7d32', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* 2. Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: '1px solid #eee', paddingBottom: '0.35rem' }}>
        <button
          onClick={() => setActiveTab('assignments')}
          style={{
            background: activeTab === 'assignments' ? '#1565c0' : '#f5f5f5',
            color: activeTab === 'assignments' ? '#fff' : '#444',
            border: 'none',
            padding: '0.4rem 0.8rem',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}
        >
          <Truck size={14} />
          Auto-Suggest Assignments ({suggestions.length})
        </button>

        <button
          onClick={() => setActiveTab('staging')}
          style={{
            background: activeTab === 'staging' ? '#1565c0' : '#f5f5f5',
            color: activeTab === 'staging' ? '#fff' : '#444',
            border: 'none',
            padding: '0.4rem 0.8rem',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}
        >
          <Navigation size={14} />
          Ambulance Staging Hubs ({stagingHubs.length})
        </button>

        <button
          onClick={() => setActiveTab('shelters')}
          style={{
            background: activeTab === 'shelters' ? '#1565c0' : '#f5f5f5',
            color: activeTab === 'shelters' ? '#fff' : '#444',
            border: 'none',
            padding: '0.4rem 0.8rem',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}
        >
          <Building size={14} />
          Shelter Occupancy & Balancing
        </button>
      </div>

      {/* TAB 1: Auto-Suggest Assignments */}
      {activeTab === 'assignments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#555' }}>
              Greedy matching pairs highest priority distress tickets to closest compatible available teams.
            </span>

            {suggestions.length > 0 && (
              <button
                onClick={handleAcceptAll}
                disabled={isAcceptingAll}
                style={{
                  background: 'linear-gradient(135deg, #1565c0, #0d47a1)',
                  color: '#fff',
                  border: 'none',
                  padding: '0.45rem 1rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 2px 6px rgba(21, 101, 192, 0.3)'
                }}
              >
                {isAcceptingAll ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                ⚡ Accept All Matches ({suggestions.length})
              </button>
            )}
          </div>

          {suggestions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', background: '#f9f9f9', borderRadius: '8px', color: '#666', fontSize: '0.85rem' }}>
              <CheckCircle2 size={28} color="#2e7d32" style={{ margin: '0 auto 0.5rem' }} />
              <div><strong>All active distress tickets have been assigned!</strong></div>
              <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {unassignedCount === 0 ? 'No unassigned tickets in queue.' : 'All available rescue teams are currently dispatched.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '380px', overflowY: 'auto' }}>
              {suggestions.map((s) => (
                <div
                  key={s.ticketId}
                  style={{
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    background: s.priorityTier === 'CRITICAL' ? '#fffafa' : '#ffffff',
                    borderLeft: `4px solid ${s.priorityTier === 'CRITICAL' ? '#b71c1c' : s.priorityTier === 'HIGH' ? '#e65100' : '#1976d2'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: s.priorityTier === 'CRITICAL' ? '#b71c1c' : s.priorityTier === 'HIGH' ? '#e65100' : '#1976d2',
                        color: '#fff'
                      }}>
                        ⚡ {s.priorityScore} PTS [{s.priorityTier}]
                      </span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'capitalize' }}>
                        {s.emergencyType.replace('_', ' ')}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#666' }}>
                        👥 {s.peopleAtRisk} victims
                      </span>
                    </div>

                    <button
                      onClick={() => handleAcceptSingle(s)}
                      disabled={acceptingTeamId === s.teamId}
                      style={{
                        background: '#2e7d32',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.3rem 0.6rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}
                    >
                      {acceptingTeamId === s.teamId ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                      Accept Match
                    </button>
                  </div>

                  <div style={{ fontSize: '0.8rem', color: '#333' }}>
                    {s.ticketSummary}
                  </div>

                  {s.vulnerableFlags.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {s.vulnerableFlags.map(f => (
                        <span key={f} style={{ fontSize: '0.65rem', background: '#ffebee', color: '#c62828', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: 600 }}>
                          ⚠️ {f.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Team Assignment Banner */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f9ff', padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #d0e2ff', fontSize: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Truck size={14} color="#1565c0" />
                      <strong>{s.teamName}</strong>
                      <span style={{ color: '#666' }}>({s.teamType.replace('_', ' ').toUpperCase()})</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#0d47a1', fontWeight: 600 }}>
                      <span>{s.distanceKm} km</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <Clock size={12} /> ~{s.estimatedEtaMin} min ETA
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.7rem', color: '#555', fontStyle: 'italic' }}>
                    💡 Rationale: {s.rationale}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Ambulance Staging Hubs */}
      {activeTab === 'staging' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#555' }}>
            Spatial clusters of $\ge 2$ active distress calls within 2.0 km identified as forward medical staging zones.
          </div>

          {stagingHubs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', background: '#f9f9f9', borderRadius: '8px', color: '#666', fontSize: '0.85rem' }}>
              <Navigation size={28} color="#1565c0" style={{ margin: '0 auto 0.5rem' }} />
              <div>No dense multi-ticket clusters currently active.</div>
              <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Distress incidents are spatially distributed.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
              {stagingHubs.map(hub => (
                <div
                  key={hub.id}
                  style={{
                    border: '1px solid #90caf9',
                    background: '#f8fbff',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.85rem', color: '#0d47a1', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Navigation size={14} />
                      {hub.name}
                    </strong>
                    <span style={{ fontSize: '0.7rem', background: '#ffebee', color: '#b71c1c', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>
                      {hub.ticketCount} Incidents
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                    <div style={{ background: '#fff', padding: '0.35rem', borderRadius: '4px', border: '1px solid #eee' }}>
                      <span style={{ color: '#777', display: 'block', fontSize: '0.65rem' }}>People at Risk</span>
                      <strong>👥 {hub.peopleAtRisk} victims</strong>
                    </div>
                    <div style={{ background: '#fff', padding: '0.35rem', borderRadius: '4px', border: '1px solid #eee' }}>
                      <span style={{ color: '#777', display: 'block', fontSize: '0.65rem' }}>Recommended Staging</span>
                      <strong style={{ color: '#1565c0' }}>🚑 {hub.recommendedAmbulances} Ambulances</strong>
                    </div>
                  </div>

                  {hub.nearestFacilityName && (
                    <div style={{ fontSize: '0.72rem', color: '#444', background: '#fff', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
                      🏥 <strong>Referral Hospital:</strong> {hub.nearestFacilityName} ({hub.nearestFacilityDistanceKm} km)
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
                    <small style={{ color: '#777', fontSize: '0.7rem' }}>
                      Centroid: {hub.lat}, {hub.lng}
                    </small>
                    {onFocusCoordinates && (
                      <button
                        onClick={() => onFocusCoordinates(hub.lat, hub.lng)}
                        style={{
                          background: 'none',
                          border: '1px solid #1976d2',
                          color: '#1976d2',
                          borderRadius: '4px',
                          padding: '0.2rem 0.45rem',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.2rem'
                        }}
                      >
                        Map View <ArrowRight size={10} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Shelter Occupancy & Load Balancing */}
      {activeTab === 'shelters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#555' }}>
            Real-time shelter utilization monitoring with automatic overflow diversion recommendations.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {shelterMetrics.map(shelter => (
              <div
                key={shelter.facilityId}
                style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  background: shelter.status === 'critical' ? '#fff5f5' : '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Building size={16} color={shelter.status === 'critical' ? '#c62828' : '#1565c0'} />
                    <strong style={{ fontSize: '0.85rem' }}>{shelter.name}</strong>
                    <span style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase' }}>
                      ({shelter.kind})
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      padding: '0.15rem 0.45rem',
                      borderRadius: '4px',
                      background: shelter.status === 'critical' ? '#ffebee' : shelter.status === 'moderate' ? '#fff3e0' : '#e8f5e9',
                      color: shelter.status === 'critical' ? '#c62828' : shelter.status === 'moderate' ? '#e65100' : '#2e7d32'
                    }}>
                      {shelter.utilizationPct}% OCCUPIED
                    </span>

                    {/* Quick Adjust Buttons */}
                    <div style={{ display: 'flex', gap: '0.2rem' }}>
                      <button
                        onClick={() => handleAdjustShelter(shelter.facilityId, -5)}
                        title="Minus 5 evacuees"
                        style={{ background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '3px', padding: '0.1rem 0.35rem', fontSize: '0.7rem', cursor: 'pointer' }}
                      >
                        -5
                      </button>
                      <button
                        onClick={() => handleAdjustShelter(shelter.facilityId, 5)}
                        title="Add 5 evacuees"
                        style={{ background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '3px', padding: '0.1rem 0.35rem', fontSize: '0.7rem', cursor: 'pointer' }}
                      >
                        +5
                      </button>
                    </div>
                  </div>
                </div>

                {/* Occupancy Progress Bar */}
                <div style={{ width: '100%', height: '8px', background: '#eee', borderRadius: '4px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, shelter.utilizationPct)}%`,
                      height: '100%',
                      background: shelter.status === 'critical' ? '#d32f2f' : shelter.status === 'moderate' ? '#f57c00' : '#388e3c',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#666' }}>
                  <span>Headcount: <strong>{shelter.occupancy}</strong> / {shelter.capacity} persons</span>
                  <span>Available Space: <strong>{Math.max(0, shelter.capacity - shelter.occupancy)}</strong></span>
                </div>

                {/* Overcrowding Diversion Recommendation */}
                {shelter.status === 'critical' && shelter.recommendedDiversion && (
                  <div style={{
                    marginTop: '0.2rem',
                    background: '#ffebee',
                    border: '1px solid #ffcdd2',
                    borderRadius: '6px',
                    padding: '0.45rem 0.65rem',
                    fontSize: '0.75rem',
                    color: '#b71c1c',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}>
                    <ShieldAlert size={14} />
                    <span>
                      <strong>OVERFLOW WARNING:</strong> Divert evacuees to <strong>{shelter.recommendedDiversion.targetName}</strong> ({shelter.recommendedDiversion.availableCapacity} open slots, {shelter.recommendedDiversion.distanceKm} km away).
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
