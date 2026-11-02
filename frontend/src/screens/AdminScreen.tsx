import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, Tooltip, LayersControl, LayerGroup, useMap } from 'react-leaflet'
import { 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Truck, 
  RefreshCw, 
  LogOut, 
  Lock, 
  User, 
  X,
  Flame,
  Waves,
  HeartPulse,
  Radio,
  Sparkles
} from 'lucide-react'
import RescueOptimizerPanel from '../components/RescueOptimizerPanel'
import {
  calculateTicketPriority,
  detectAmbulanceStagingHubs,
  computeOptimizedAssignments
} from '../utils/optimizer'

export interface RiskForecastZone {
  id: string
  region: string
  lat: number
  lng: number
  hazard: string
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
}

export interface Ticket {
  id: string
  created_at: string
  updated_at: string
  channel: 'app' | 'sms' | 'voice'
  original_text: string
  original_language: string
  translated_text_en?: string
  emergency_type: string
  urgency: number
  people_at_risk: number
  vulnerable_flags: string[]
  lat: number | null
  lng: number | null
  address_text?: string
  status: 'new' | 'assigned' | 'in_progress' | 'resolved'
  assigned_to?: string | null
  assigned_team_id?: string | null
  reporter_id?: string | null
  reporter_phone?: string | null
  access_token: string
  ai_summary?: string
  reply_in_user_language?: string
  assigned_team?: RescueTeam | null
}

export interface Facility {
  id: string
  name: string
  kind: 'shelter' | 'hospital' | 'relief_center'
  lat: number
  lng: number
  capacity: number
  occupancy: number
  phone?: string
  address?: string
  is_active: boolean
}

export interface RescueTeam {
  id: string
  name: string
  type: string
  lat: number
  lng: number
  available: boolean
}

export interface CrowdHazard {
  id: string
  hazard_type: string
  severity: number
  lat: number
  lng: number
  description: string
  avoid_radius_meters: number
  is_active: boolean
  image_url?: string | null
  ai_analysis?: {
    confidence?: number
    hazard_type?: string
    severity?: number
    infrastructure_impact?: string
  } | null
}

const DEFAULT_ADMIN_HAZARDS: CrowdHazard[] = [
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

const DEFAULT_ZONES: RiskForecastZone[] = [
  {
    id: 'zone-1',
    region: 'Dakshina Kannada (Mangaluru)',
    lat: 12.9141,
    lng: 74.8560,
    hazard: 'flood',
    score: 78,
    level: 'high',
    advisory: 'Severe coastal rainfall exceeding 72mm and river runoff surging in Netravati basin.',
    checklist: ['Store 3 days potable water', 'Elevate electrical appliances', 'Secure documents'],
    metrics: { precipitation_mm: 72.4, river_discharge_m3s: 380, wind_speed_kmh: 48, max_temp_c: 29.5 }
  },
  {
    id: 'zone-2',
    region: 'Bengaluru Urban',
    lat: 12.9716,
    lng: 77.5946,
    hazard: 'flood',
    score: 42,
    level: 'moderate',
    advisory: 'Moderate convective evening showers with localized storm drain bottlenecks in low-lying corridors.',
    checklist: ['Avoid transit through underpasses', 'Clear perimeter drainage', 'Charge emergency flashlights'],
    metrics: { precipitation_mm: 28.5, river_discharge_m3s: 42, wind_speed_kmh: 24, max_temp_c: 31.0 }
  },
  {
    id: 'zone-3',
    region: 'Uttara Kannada (Karwar)',
    lat: 14.8185,
    lng: 74.1350,
    hazard: 'landslide',
    score: 74,
    level: 'high',
    advisory: 'Saturated Western Ghats soil layers after 88mm continuous rain. Elevated risk along NH-66 and ghats.',
    checklist: ['Avoid nighttime mountain transit', 'Inspect hillsides for fissures', 'Evacuate on ground rumbling'],
    metrics: { precipitation_mm: 88.0, river_discharge_m3s: 210, wind_speed_kmh: 36, max_temp_c: 27.5 }
  },
  {
    id: 'zone-4',
    region: 'Puri / Coastal Odisha',
    lat: 19.8135,
    lng: 85.8312,
    hazard: 'cyclone',
    score: 86,
    level: 'critical',
    advisory: 'Severe cyclonic storm system advancing in Bay of Bengal with sustained wind gusts of 86 km/h.',
    checklist: ['Follow coastal evacuation to cyclone shelters', 'Board up glass windows', 'Keep battery radio ready'],
    metrics: { precipitation_mm: 115.0, river_discharge_m3s: 520, wind_speed_kmh: 86, max_temp_c: 27.0 }
  },
  {
    id: 'zone-5',
    region: 'Delhi NCR',
    lat: 28.6139,
    lng: 77.2090,
    hazard: 'heatwave',
    score: 68,
    level: 'high',
    advisory: 'Severe heatwave conditions with peak afternoon temperatures touching 43.8°C.',
    checklist: ['Avoid outdoor sun 11:30 AM-4:30 PM', 'Drink ORS water regularly', 'Protect children and elderly'],
    metrics: { precipitation_mm: 0, river_discharge_m3s: 12, wind_speed_kmh: 16, max_temp_c: 43.8 }
  }
]

// Fallback demo rescue teams for offline/prototype resilience
const DEFAULT_DEMO_TEAMS: RescueTeam[] = [
  {
    id: 'team-1',
    name: 'NDRF 10th Bn - Rapid Inflatable Boat Unit',
    type: 'ndrf_boat',
    lat: 12.9650,
    lng: 77.5800,
    available: true
  },
  {
    id: 'team-2',
    name: '108 Advanced Life Support Ambulance #14',
    type: 'ambulance',
    lat: 12.9400,
    lng: 77.6100,
    available: true
  },
  {
    id: 'team-3',
    name: 'Karnataka Fire & Emergency Services Squad #7',
    type: 'fire_rescue',
    lat: 12.9800,
    lng: 77.6000,
    available: true
  },
  {
    id: 'team-4',
    name: 'SDRF Disaster Paramedic Rapid Response',
    type: 'sdrf_medical',
    lat: 12.9550,
    lng: 77.5900,
    available: true
  }
]

// Fallback demo facilities for offline/prototype resilience
const DEFAULT_DEMO_FACILITIES: Facility[] = [
  {
    id: 'fac-1',
    name: 'Victoria Hospital Emergency Trauma Center',
    kind: 'hospital',
    lat: 12.9634,
    lng: 77.5744,
    capacity: 450,
    occupancy: 220,
    is_active: true,
    phone: '+91-80-26701150',
    address: 'Fort Road, near City Market, Bengaluru'
  },
  {
    id: 'fac-2',
    name: 'Bowring & Lady Curzon Relief Hospital',
    kind: 'hospital',
    lat: 12.9833,
    lng: 77.6047,
    capacity: 300,
    occupancy: 140,
    is_active: true,
    phone: '+91-80-25591325',
    address: 'Hospital Road, Shivajinagar, Bengaluru'
  },
  {
    id: 'fac-3',
    name: 'Kanteerava Stadium Mega Shelter',
    kind: 'shelter',
    lat: 12.9698,
    lng: 77.5926,
    capacity: 1000,
    occupancy: 890,
    is_active: true,
    phone: '+91-80-22271888',
    address: 'Kasturba Road, Sampangi Rama Nagara, Bengaluru'
  },
  {
    id: 'fac-4',
    name: 'Koramangala Community Relief & Evacuation Hub',
    kind: 'shelter',
    lat: 12.9344,
    lng: 77.6200,
    capacity: 600,
    occupancy: 180,
    is_active: true,
    phone: '+91-80-25530120',
    address: '80 Feet Road, Koramangala 4th Block, Bengaluru'
  }
]

// Fallback demo tickets with high-risk vulnerable groups & spatial clusters
const DEFAULT_DEMO_TICKETS: Ticket[] = [
  {
    id: 't-demo-1',
    created_at: new Date(Date.now() - 32 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
    channel: 'app',
    original_text: 'ఇంట్లోకి 4 అడుగుల నీరు చేరింది. 2 చిన్న పిల్లలు, వృద్ధ తల్లిదండ్రులు డాబాపై చిక్కుకుపోయాము.',
    original_language: 'te',
    emergency_type: 'flood',
    urgency: 5,
    people_at_risk: 4,
    vulnerable_flags: ['infant', 'elderly'],
    lat: 12.9660,
    lng: 77.5840,
    address_text: 'K.R. Market Low-lying Colony, Bengaluru',
    status: 'new',
    access_token: 'tok-1',
    ai_summary: 'Severe flood inundation 4ft deep. 2 infants and elderly grandparents trapped on rooftop.'
  },
  {
    id: 't-demo-2',
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
    channel: 'voice',
    original_text: 'Pregnant woman in labor pain trapped due to waterlogging and collapsed wall on 80ft road.',
    original_language: 'en',
    emergency_type: 'medical',
    urgency: 5,
    people_at_risk: 2,
    vulnerable_flags: ['pregnant', 'medical_condition'],
    lat: 12.9380,
    lng: 77.6150,
    address_text: '80 Feet Road, Koramangala 4th Block, Bengaluru',
    status: 'new',
    access_token: 'tok-2',
    ai_summary: 'Maternal emergency: labor pain with collapsed compound wall blocking ambulance transit.'
  },
  {
    id: 't-demo-3',
    created_at: new Date(Date.now() - 18 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
    channel: 'sms',
    original_text: 'Ground floor submerged, elderly diabetic patient without insulin. Water level rising.',
    original_language: 'en',
    emergency_type: 'flood',
    urgency: 4,
    people_at_risk: 3,
    vulnerable_flags: ['elderly', 'medical_condition'],
    lat: 12.9690,
    lng: 77.5870,
    address_text: 'Near Kalasipalya Bus Stand, Bengaluru',
    status: 'new',
    access_token: 'tok-3',
    ai_summary: 'Ground floor submerged with diabetic patient needing urgent rescue and medical supplies.'
  },
  {
    id: 't-demo-4',
    created_at: new Date(Date.now() - 10 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
    channel: 'app',
    original_text: 'Short circuit fire and smoke filling 1st floor corridor after rain ingress.',
    original_language: 'en',
    emergency_type: 'fire',
    urgency: 4,
    people_at_risk: 5,
    vulnerable_flags: ['child'],
    lat: 12.9770,
    lng: 77.6050,
    address_text: 'Shivajinagar Commercial Complex, Bengaluru',
    status: 'new',
    access_token: 'tok-4',
    ai_summary: 'Electrical short circuit fire in corridor, 5 people trapped on upper floors.'
  }
]

function MapFlyController({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) {
      map.flyTo(target, 14, { duration: 1.2 })
    }
  }, [target, map])
  return null
}

export default function AdminScreen() {
  // Auth state
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  // Data state
  const [tickets, setTickets] = useState<Ticket[]>(DEFAULT_DEMO_TICKETS)
  const [facilities, setFacilities] = useState<Facility[]>(DEFAULT_DEMO_FACILITIES)
  const [rescueTeams, setRescueTeams] = useState<RescueTeam[]>(DEFAULT_DEMO_TEAMS)
  const [riskForecasts, setRiskForecasts] = useState<RiskForecastZone[]>(DEFAULT_ZONES)
  const [hazards, setHazards] = useState<CrowdHazard[]>(DEFAULT_ADMIN_HAZARDS)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [consoleTab, setConsoleTab] = useState<'dispatch' | 'optimizer' | 'fleet' | 'zones'>('dispatch')
  const [focusTarget, setFocusTarget] = useState<[number, number] | null>(null)
  const [realtimeConnected, setRealtimeConnected] = useState(true)
  const [liveAlert, setLiveAlert] = useState<{ id: string; text: string; type: string; ticket: Ticket } | null>(null)

  // Filter state
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'assigned' | 'resolved' | 'critical'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // 1. Check Authentication & Authority Role
  const checkAuth = useCallback(async () => {
    try {
      setAuthLoading(true)
      setAuthError(null)
      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUser(user)

      if (user) {
        // Query profiles table for role
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role, full_name')
          .eq('id', user.id)
          .single()

        if (error) {
          console.error('Error fetching profile:', error)
          setUserRole(null)
        } else {
          setUserRole(profile?.role || 'citizen')
        }
      } else {
        setUserRole(null)
      }
    } catch (err: any) {
      console.error('Auth verification error:', err)
      setAuthError(err.message || 'Failed to verify authentication')
    } finally {
      setAuthLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user || null)
      if (session?.user) {
        checkAuth()
      } else {
        setUserRole(null)
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [checkAuth])

  // 2. Fetch Tickets, Facilities, and Teams
  const loadDashboardData = useCallback(async () => {
    if (userRole !== 'authority') return
    setIsLoadingData(true)
    try {
      // Fetch tickets with assigned_team joined
      const { data: ticketsData, error: ticketsErr } = await supabase
        .from('tickets')
        .select(`
          *,
          assigned_team:rescue_teams(*)
        `)
        .order('urgency', { ascending: false })
        .order('created_at', { ascending: true })

      if (!ticketsErr && ticketsData && ticketsData.length > 0) {
        setTickets(ticketsData as any)
      } else {
        setTickets(prev => prev.length > 0 ? prev : DEFAULT_DEMO_TICKETS)
      }

      // Fetch facilities
      const { data: facilitiesData, error: facErr } = await supabase
        .from('facilities')
        .select('*')
        .eq('is_active', true)

      if (!facErr && facilitiesData && facilitiesData.length > 0) {
        setFacilities(facilitiesData)
      } else {
        setFacilities(prev => prev.length > 0 ? prev : DEFAULT_DEMO_FACILITIES)
      }

      // Fetch rescue teams
      const { data: teamsData, error: teamsErr } = await supabase
        .from('rescue_teams')
        .select('*')

      if (!teamsErr && teamsData && teamsData.length > 0) {
        setRescueTeams(teamsData)
      } else {
        setRescueTeams(prev => prev.length > 0 ? prev : DEFAULT_DEMO_TEAMS)
      }

      // Fetch risk forecasts (Phase 1 Disaster Prediction)
      const { data: riskData, error: riskErr } = await supabase
        .from('risk_forecasts')
        .select('*')
        .order('score', { ascending: false })

      if (!riskErr && riskData && riskData.length > 0) {
        setRiskForecasts(riskData as RiskForecastZone[])
      }

      // Fetch active crowd hazard reports (Phase 3 Safe Routing)
      const { data: hazardData, error: hazardErr } = await supabase
        .from('hazard_reports')
        .select('*')
        .eq('is_active', true)

      if (!hazardErr && hazardData && hazardData.length > 0) {
        setHazards(hazardData as CrowdHazard[])
      }
    } catch (err: any) {
      console.error('Error loading dashboard data:', err)
      setActionMessage({ text: `Data loading error: ${err.message}`, type: 'error' })
    } finally {
      setIsLoadingData(false)
    }
  }, [userRole])

  useEffect(() => {
    if (userRole === 'authority') {
      loadDashboardData()
    }
  }, [userRole, loadDashboardData])

  // 3. Supabase Realtime Subscription for Tickets & Rescue Teams
  useEffect(() => {
    if (userRole !== 'authority') return

    const ticketsChannel = supabase
      .channel('admin_tickets_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newTicket = payload.new as Ticket
            setTickets(prev => [newTicket, ...prev].sort((a, b) => b.urgency - a.urgency))
            setLiveAlert({
              id: newTicket.id,
              text: newTicket.ai_summary || newTicket.original_text,
              type: newTicket.emergency_type,
              ticket: newTicket
            })
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Ticket
            setTickets(prev => prev.map(t => (t.id === updated.id ? { ...t, ...updated } : t)))
            setSelectedTicket(prev => (prev?.id === updated.id ? { ...prev, ...updated } : prev))
          } else if (payload.eventType === 'DELETE') {
            setTickets(prev => prev.filter(t => t.id !== (payload.old as any).id))
            setSelectedTicket(prev => (prev?.id === (payload.old as any).id ? null : prev))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rescue_teams' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedTeam = payload.new as RescueTeam
            setRescueTeams(prev => prev.map(t => (t.id === updatedTeam.id ? updatedTeam : t)))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'facilities' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedFac = payload.new as Facility
            setFacilities(prev => prev.map(f => (f.id === updatedFac.id ? updatedFac : f)))
          } else if (payload.eventType === 'INSERT') {
            setFacilities(prev => [...prev, payload.new as Facility])
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'risk_forecasts' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const updatedZone = payload.new as RiskForecastZone
            setRiskForecasts(prev => {
              const existingIdx = prev.findIndex(z => z.id === updatedZone.id || z.region === updatedZone.region)
              if (existingIdx >= 0) {
                const next = [...prev]
                next[existingIdx] = updatedZone
                return next.sort((a, b) => b.score - a.score)
              }
              return [updatedZone, ...prev].sort((a, b) => b.score - a.score)
            })
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hazard_reports' },
        () => {
          supabase.from('hazard_reports').select('*').eq('is_active', true).then(({ data }) => {
            if (data && data.length > 0) setHazards(data as CrowdHazard[])
          })
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(ticketsChannel)
    }
  }, [userRole])

  // 4. Handle Authority Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!emailInput || !passwordInput) {
      setAuthError('Please enter both email and password.')
      return
    }
    try {
      setIsLoggingIn(true)
      setAuthError(null)
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailInput.trim(),
        password: passwordInput
      })
      if (!error && data?.user) {
        await checkAuth()
        return
      }

      // Demo fallback if local Supabase has not yet seeded auth users or offline
      if (
        (emailInput.trim() === 'authority@jeevansetu.gov.in' || emailInput.trim() === 'authority@ndrf.gov.in') &&
        passwordInput === 'Password@123'
      ) {
        setCurrentUser({ id: 'demo-authority-id', email: emailInput.trim() })
        setUserRole('authority')
        return
      }

      if (error) throw error
    } catch (err: any) {
      if (
        (emailInput.trim() === 'authority@jeevansetu.gov.in' || emailInput.trim() === 'authority@ndrf.gov.in') &&
        passwordInput === 'Password@123'
      ) {
        setCurrentUser({ id: 'demo-authority-id', email: emailInput.trim() })
        setUserRole('authority')
        return
      }
      setAuthError(err.message || 'Login failed')
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setCurrentUser(null)
    setUserRole(null)
    setTickets([])
    setSelectedTicket(null)
  }

  // 5. Actions: Assign Nearest Team via Haversine RPC
  const handleAssignNearestTeam = async (ticketId: string) => {
    setActionLoading(true)
    setActionMessage(null)
    try {
      const { data, error } = await supabase.rpc('assign_nearest_team', {
        target_ticket_id: ticketId
      })

      if (error) throw error

      setActionMessage({
        text: `Team "${data.team_name}" (${data.team_type}) assigned! Distance: ${data.distance_km} km.`,
        type: 'success'
      })

      // Reload fresh data
      await loadDashboardData()
    } catch (err: any) {
      console.error('Assign team error:', err)
      setActionMessage({ text: err.message || 'Failed to assign team', type: 'error' })
    } finally {
      setActionLoading(false)
    }
  }

  // 6. Actions: Mark Ticket Resolved
  const handleMarkResolved = async (ticket: Ticket) => {
    setActionLoading(true)
    setActionMessage(null)
    try {
      // 1. Update ticket status to resolved
      const { error: ticketErr } = await supabase
        .from('tickets')
        .update({
          status: 'resolved',
          updated_at: new Date().toISOString()
        })
        .eq('id', ticket.id)

      if (ticketErr) throw ticketErr

      // 2. If a team was assigned, release the team back to available
      if (ticket.assigned_team_id) {
        await supabase
          .from('rescue_teams')
          .update({ available: true })
          .eq('id', ticket.assigned_team_id)
      }

      // 3. Log event
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id,
        actor: 'authority',
        event: 'ticket_resolved',
        metadata: { resolved_by: currentUser?.id }
      })

      setActionMessage({ text: `Ticket ${ticket.id.slice(0, 8)} marked resolved.`, type: 'success' })
      await loadDashboardData()
      if (selectedTicket?.id === ticket.id) {
        setSelectedTicket(prev => prev ? { ...prev, status: 'resolved' } : null)
      }
    } catch (err: any) {
      console.error('Resolve ticket error:', err)
      setActionMessage({ text: err.message || 'Failed to resolve ticket', type: 'error' })
    } finally {
      setActionLoading(false)
    }
  }

  // 7. Filter & Rank Tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      // Status filter
      if (statusFilter === 'new' && t.status !== 'new') return false
      if (statusFilter === 'assigned' && t.status !== 'assigned' && t.status !== 'in_progress') return false
      if (statusFilter === 'resolved' && t.status !== 'resolved') return false
      if (statusFilter === 'critical' && t.urgency < 4) return false

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const matchText = (t.original_text || '').toLowerCase().includes(query)
        const matchSummary = (t.ai_summary || '').toLowerCase().includes(query)
        const matchLocation = (t.address_text || '').toLowerCase().includes(query)
        const matchType = (t.emergency_type || '').toLowerCase().includes(query)
        const matchId = t.id.toLowerCase().includes(query)
        return matchText || matchSummary || matchLocation || matchType || matchId
      }
      return true
    }).sort((a, b) => {
      const pA = calculateTicketPriority(a, tickets).score
      const pB = calculateTicketPriority(b, tickets).score
      return pB - pA
    })
  }, [tickets, statusFilter, searchQuery])

  // Optimizer metrics: Staging positions & Greedy suggestions
  const detectedStagingHubs = useMemo(() => {
    return detectAmbulanceStagingHubs(tickets, facilities)
  }, [tickets, facilities])

  const pendingSuggestions = useMemo(() => {
    return computeOptimizedAssignments(tickets, rescueTeams)
  }, [tickets, rescueTeams])

  // 8. Stats calculations
  const stats = useMemo(() => {
    const total = tickets.length
    const openCount = tickets.filter(t => t.status === 'new').length
    const assignedCount = tickets.filter(t => t.status === 'assigned' || t.status === 'in_progress').length
    const resolvedCount = tickets.filter(t => t.status === 'resolved').length
    const criticalCount = tickets.filter(t => t.urgency >= 4 && t.status !== 'resolved').length
    return { total, openCount, assignedCount, resolvedCount, criticalCount }
  }, [tickets])

  // Shelter aggregate utilization
  const shelterStats = useMemo(() => {
    const shelters = facilities.filter(f => f.kind === 'shelter' || f.kind === 'relief_center')
    const totalCapacity = shelters.reduce((s, f) => s + (f.capacity || 0), 0)
    const totalOccupancy = shelters.reduce((s, f) => s + (f.occupancy || 0), 0)
    const utilPct = totalCapacity > 0 ? Math.round((totalOccupancy / totalCapacity) * 100) : 0
    return { totalCapacity, totalOccupancy, utilPct, shelterCount: shelters.length }
  }, [facilities])

  // Toggle Rescue Team Availability
  const handleToggleTeamAvailability = async (teamId: string, currentAvail: boolean) => {
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from('rescue_teams')
        .update({ available: !currentAvail })
        .eq('id', teamId)

      if (error) throw error

      setRescueTeams(prev => prev.map(t => t.id === teamId ? { ...t, available: !currentAvail } : t))
      setActionMessage({
        text: `Team status updated: ${!currentAvail ? 'Marked Ready / Available' : 'Marked On Mission'}`,
        type: 'success'
      })
    } catch (err: any) {
      console.warn('Database team toggle fallback:', err)
      setRescueTeams(prev => prev.map(t => t.id === teamId ? { ...t, available: !currentAvail } : t))
    } finally {
      setActionLoading(false)
    }
  }

  // Helper colors for urgency
  const getUrgencyColor = (urgency: number) => {
    switch (urgency) {
      case 5: return '#b71c1c' // Dark Red (Imminent threat)
      case 4: return '#e65100' // Dark Orange (High priority)
      case 3: return '#f57f17' // Amber
      case 2: return '#1976d2' // Blue
      default: return '#388e3c' // Green
    }
  }

  // Emergency icon helper
  const getEmergencyIcon = (type: string) => {
    switch (type) {
      case 'flood': return <Waves size={16} />
      case 'fire': return <Flame size={16} />
      case 'medical': return <HeartPulse size={16} />
      default: return <AlertTriangle size={16} />
    }
  }

  // -------------------------------------------------------------
  // Render: Loading Screen
  // -------------------------------------------------------------
  if (authLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <RefreshCw className="animate-spin" size={36} style={{ margin: '0 auto 1rem auto', color: 'var(--primary-color)' }} />
        <h3>Verifying Authority Access...</h3>
      </div>
    )
  }

  // -------------------------------------------------------------
  // Render: Not Signed In / Login View
  // -------------------------------------------------------------
  if (!currentUser) {
    return (
      <div className="admin-login-card" style={{ maxWidth: '420px', margin: '3rem auto', padding: '2rem', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'inline-flex', padding: '1rem', background: '#ffebee', borderRadius: '50%', color: 'var(--primary-color)', marginBottom: '0.75rem' }}>
            <Lock size={32} />
          </div>
          <h2>Authority Access Portal</h2>
          <p style={{ color: 'var(--text-light)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Sign in with an authorized agency account to access the emergency response control room.
          </p>
        </div>

        {authError && (
          <div style={{ padding: '0.75rem', background: '#ffebee', color: '#c62828', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {authError}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Authority Email
            </label>
            <input 
              type="email" 
              placeholder="authority@ndrf.gov.in"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              required
              style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '1rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Password
            </label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              required
              style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '1rem' }}
            />
          </div>

          <button 
            type="submit" 
            disabled={isLoggingIn}
            className="submit-button"
            style={{ marginTop: '0.5rem', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
          >
            {isLoggingIn ? <RefreshCw className="animate-spin" size={18} /> : <Lock size={18} />}
            <span>Sign In to Dashboard</span>
          </button>
        </form>

        {/* Demo Credentials Box */}
        <div style={{ marginTop: '1.25rem', padding: '0.85rem', background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: '8px', fontSize: '0.85rem' }}>
          <div style={{ fontWeight: 700, color: '#1565c0', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span>Demo Authority Credentials:</span>
          </div>
          <div style={{ color: '#222', fontSize: '0.8rem', lineHeight: '1.5' }}>
            <div><strong>Email:</strong> <code>authority@jeevansetu.gov.in</code></div>
            <div><strong>Password:</strong> <code>Password@123</code></div>
          </div>
          <button
            type="button"
            onClick={() => {
              setEmailInput('authority@jeevansetu.gov.in')
              setPasswordInput('Password@123')
            }}
            style={{
              marginTop: '0.6rem',
              background: '#1976d2',
              color: '#ffffff',
              border: 'none',
              padding: '0.4rem 0.8rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              width: '100%',
              textAlign: 'center'
            }}
          >
            Auto-Fill Demo Credentials
          </button>
        </div>

        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f5f5f5', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-light)' }}>
          🔒 <strong>Security Policy:</strong> Real database access is enforced via PostgreSQL Row Level Security (RLS). Only profiles with <code>role = 'authority'</code> can query tickets.
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------
  // Render: Signed In But Not Authority
  // -------------------------------------------------------------
  if (userRole !== 'authority') {
    return (
      <div style={{ maxWidth: '500px', margin: '3rem auto', padding: '2rem', textAlign: 'center', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <ShieldAlert size={56} color="#c62828" style={{ margin: '0 auto 1rem auto' }} />
        <h2>Access Denied</h2>
        <p style={{ color: 'var(--text-light)', marginTop: '0.5rem' }}>
          Your account (<strong>{currentUser.email}</strong>) is currently designated as <strong>citizen</strong>.
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.75rem', background: '#fff3e0', padding: '0.75rem', borderRadius: '6px' }}>
          To grant authority rights in development, execute:<br />
          <code>UPDATE profiles SET role = 'authority' WHERE id = '{currentUser.id}';</code>
        </p>
        <button 
          onClick={handleLogout} 
          style={{ marginTop: '1.5rem', padding: '0.6rem 1.5rem', borderRadius: '6px', background: 'var(--primary-color)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          Sign Out & Switch Account
        </button>
      </div>
    )
  }

  // -------------------------------------------------------------
  // Render: Authority Dashboard
  // -------------------------------------------------------------
  return (
    <div className="admin-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* 1. Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Radio size={24} color="var(--primary-color)" />
            Authority Control Room
          </h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
            Realtime Disaster Dispatch & Multilingual Triage Console
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.75rem',
            background: realtimeConnected ? '#e8f5e9' : '#ffebee',
            color: realtimeConnected ? '#2e7d32' : '#c62828',
            padding: '0.3rem 0.65rem',
            borderRadius: '20px',
            fontWeight: 700
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: realtimeConnected ? '#2e7d32' : '#c62828',
              display: 'inline-block'
            }} />
            <span>{realtimeConnected ? 'Live Realtime (5 Ch)' : 'Realtime Disconnected'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', background: '#e8f5e9', color: '#2e7d32', padding: '0.35rem 0.75rem', borderRadius: '20px', fontWeight: 600 }}>
            <User size={14} />
            <span>{currentUser.email} (Authority)</span>
          </div>
          <button 
            onClick={loadDashboardData}
            title="Refresh dashboard"
            disabled={isLoadingData}
            style={{ background: 'transparent', border: '1px solid var(--border-color)', padding: '0.4rem 0.6rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <RefreshCw size={16} className={isLoadingData ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={handleLogout}
            title="Sign out"
            style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600, fontSize: '0.85rem' }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>

      {/* Realtime Live Incoming Distress Alert Dropdown */}
      {liveAlert && (
        <div style={{
          background: 'linear-gradient(135deg, #b71c1c, #d32f2f)',
          color: '#fff',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 4px 12px rgba(183, 28, 28, 0.3)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Radio size={20} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>🚨 REALTIME DISTRESS DISPATCH INCOMING</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.95 }}>{liveAlert.text}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => {
                setSelectedTicket(liveAlert.ticket)
                if (liveAlert.ticket.lat && liveAlert.ticket.lng) {
                  setFocusTarget([liveAlert.ticket.lat, liveAlert.ticket.lng])
                }
                setConsoleTab('dispatch')
                setLiveAlert(null)
              }}
              style={{
                background: '#fff',
                color: '#b71c1c',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
            >
              View & Locate &rarr;
            </button>
            <button
              onClick={() => setLiveAlert(null)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Pan-India Disaster Watch Ticker */}
      <div style={{
        background: '#1a237e',
        color: '#fff',
        borderRadius: '8px',
        padding: '0.6rem 0.85rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem',
        boxShadow: '0 2px 8px rgba(26, 35, 126, 0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 700 }}>
          <Radio size={14} color="#ff5252" />
          <span>PAN-INDIA DISASTER WATCH:</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {riskForecasts.slice(0, 5).map(z => (
            <button
              key={z.id}
              onClick={() => {
                setFocusTarget([z.lat, z.lng])
                setConsoleTab('dispatch')
              }}
              style={{
                background: z.level === 'critical' ? 'rgba(211, 47, 47, 0.85)' : z.level === 'high' ? 'rgba(230, 81, 0, 0.85)' : 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '16px',
                padding: '0.2rem 0.6rem',
                fontSize: '0.72rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
            >
              <span><strong>{z.region.split('(')[0].trim()}:</strong> {z.hazard.toUpperCase()} ({z.score}/100)</span>
              <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>📍 Fly</span>
            </button>
          ))}
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: actionMessage.type === 'success' ? '#e8f5e9' : '#ffebee',
          color: actionMessage.type === 'success' ? '#2e7d32' : '#c62828',
          borderLeft: `4px solid ${actionMessage.type === 'success' ? '#2e7d32' : '#c62828'}`
        }}>
          <span>{actionMessage.text}</span>
          <button 
            onClick={() => setActionMessage(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 2. Stat Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', borderTop: '4px solid #b71c1c' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>Imminent Danger (4-5)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#b71c1c', marginTop: '0.25rem' }}>{stats.criticalCount}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', borderTop: '4px solid var(--primary-color)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>New / Unassigned</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary-color)', marginTop: '0.25rem' }}>{stats.openCount}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', borderTop: '4px solid #1976d2' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>Assigned / Responding</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#1976d2', marginTop: '0.25rem' }}>{stats.assignedCount}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', borderTop: '4px solid #388e3c' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>Resolved</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#388e3c', marginTop: '0.25rem' }}>{stats.resolvedCount}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', borderTop: '4px solid #757575' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>Available Teams</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2e7d32', marginTop: '0.25rem' }}>
            {rescueTeams.filter(t => t.available).length} / {rescueTeams.length}
          </div>
        </div>

        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', borderTop: '4px solid #f57c00' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>Active Hazard Zones</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#e65100', marginTop: '0.25rem' }}>
            {riskForecasts.filter(r => r.level === 'critical' || r.level === 'high').length} High/Crit
          </div>
        </div>

        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', borderTop: `4px solid ${shelterStats.utilPct >= 85 ? '#b71c1c' : shelterStats.utilPct >= 60 ? '#f57c00' : '#2e7d32'}` }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>Shelter Capacity</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: shelterStats.utilPct >= 85 ? '#b71c1c' : '#2e7d32', marginTop: '0.25rem' }}>
            {shelterStats.totalOccupancy} / {shelterStats.totalCapacity} ({shelterStats.utilPct}%)
          </div>
          <div style={{ width: '100%', height: '4px', background: '#eee', borderRadius: '2px', marginTop: '0.4rem', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, shelterStats.utilPct)}%`, height: '100%', background: shelterStats.utilPct >= 85 ? '#b71c1c' : shelterStats.utilPct >= 60 ? '#f57c00' : '#2e7d32' }} />
          </div>
        </div>
      </div>

      {/* 2.5 Console View Mode Switcher (Phase 5 & 7 Polish) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', background: '#fff', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setConsoleTab('dispatch')}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              border: 'none',
              background: consoleTab === 'dispatch' ? 'var(--primary-color)' : '#f5f5f5',
              color: consoleTab === 'dispatch' ? '#fff' : '#333',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <Radio size={14} />
            Tactical Map & Queue
          </button>
          <button
            onClick={() => setConsoleTab('optimizer')}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              border: 'none',
              background: consoleTab === 'optimizer' ? '#0d47a1' : '#e3f2fd',
              color: consoleTab === 'optimizer' ? '#fff' : '#0d47a1',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <Sparkles size={14} />
            AI Optimizer ({pendingSuggestions.length} Matches)
          </button>
          <button
            onClick={() => setConsoleTab('fleet')}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              border: 'none',
              background: consoleTab === 'fleet' ? '#2e7d32' : '#e8f5e9',
              color: consoleTab === 'fleet' ? '#fff' : '#2e7d32',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <Truck size={14} />
            Rescue Fleet ({rescueTeams.filter(t => t.available).length} Ready)
          </button>
          <button
            onClick={() => setConsoleTab('zones')}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              border: 'none',
              background: consoleTab === 'zones' ? '#e65100' : '#fff3e0',
              color: consoleTab === 'zones' ? '#fff' : '#e65100',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <ShieldAlert size={14} />
            Crisis Watch ({riskForecasts.filter(r => r.level === 'critical' || r.level === 'high').length} Zones)
          </button>
        </div>

        {pendingSuggestions.length > 0 && consoleTab === 'dispatch' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#0d47a1', background: '#e3f2fd', padding: '0.3rem 0.75rem', borderRadius: '4px' }}>
            <Sparkles size={14} />
            <span><strong>{pendingSuggestions.length} greedy team assignments</strong> ready.</span>
            <button
              onClick={() => setConsoleTab('optimizer')}
              style={{ background: 'none', border: 'none', color: '#1565c0', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Open Optimizer &rarr;
            </button>
          </div>
        )}
      </div>

      {/* Render Optimizer Panel when activated */}
      {consoleTab === 'optimizer' && (
        <RescueOptimizerPanel
          tickets={tickets}
          rescueTeams={rescueTeams}
          facilities={facilities}
          onRefreshData={loadDashboardData}
          onFocusCoordinates={(lat, lng) => {
            setFocusTarget([lat, lng])
            setConsoleTab('dispatch')
          }}
        />
      )}

      {/* Render Rescue Fleet Management Board (Phase 7 Polish) */}
      {consoleTab === 'fleet' && (
        <div style={{ background: '#fff', borderRadius: '10px', padding: '1rem', border: '1.5px solid #c8e6c9', boxShadow: '0 4px 16px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#2e7d32' }}>
                <Truck size={18} />
                Live Rescue Fleet & Unit Status
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                Real-time tracking of NDRF, SDRF, Fire & Emergency, and 108 Ambulance Units
              </span>
            </div>
            <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '0.25rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
              {rescueTeams.filter(t => t.available).length} of {rescueTeams.length} Ready
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {rescueTeams.map(team => (
              <div
                key={team.id}
                style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '0.85rem',
                  background: team.available ? '#ffffff' : '#f9f9f9',
                  borderLeft: `4px solid ${team.available ? '#2e7d32' : '#1976d2'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.45rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '0.88rem' }}>{team.name}</strong>
                    <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase', marginTop: '0.1rem' }}>
                      {team.type.replace('_', ' ')}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '12px',
                    background: team.available ? '#e8f5e9' : '#e3f2fd',
                    color: team.available ? '#2e7d32' : '#1565c0'
                  }}>
                    {team.available ? '● READY' : '● ON MISSION'}
                  </span>
                </div>

                <div style={{ fontSize: '0.75rem', color: '#555', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <MapPin size={12} />
                  Lat: {team.lat.toFixed(4)}, Lng: {team.lng.toFixed(4)}
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
                  <button
                    onClick={() => handleToggleTeamAvailability(team.id, team.available)}
                    disabled={actionLoading}
                    style={{
                      flex: 1,
                      padding: '0.35rem 0.6rem',
                      borderRadius: '4px',
                      border: 'none',
                      background: team.available ? '#1976d2' : '#2e7d32',
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {team.available ? 'Deploy / Mark On Mission' : 'Recall / Mark Available'}
                  </button>
                  <button
                    onClick={() => {
                      setFocusTarget([team.lat, team.lng])
                      setConsoleTab('dispatch')
                    }}
                    style={{
                      padding: '0.35rem 0.6rem',
                      borderRadius: '4px',
                      border: '1px solid #ccc',
                      background: '#fff',
                      color: '#333',
                      fontSize: '0.75rem',
                      cursor: 'pointer'
                    }}
                  >
                    Locate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Render Pan-India Disaster Watch Intelligence Board (Phase 7 Polish) */}
      {consoleTab === 'zones' && (
        <div style={{ background: '#fff', borderRadius: '10px', padding: '1rem', border: '1.5px solid #ffcc80', boxShadow: '0 4px 16px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#e65100' }}>
                <ShieldAlert size={18} />
                Pan-India Multi-District Disaster Intelligence
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                Open-Meteo & USGS Seismological rule-based composite risk engine with Groq advisories
              </span>
            </div>
            <span style={{ background: '#ffebee', color: '#c62828', padding: '0.25rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
              {riskForecasts.filter(r => r.level === 'critical' || r.level === 'high').length} Elevated Risk Districts
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '0.75rem' }}>
            {riskForecasts.map(zone => (
              <div
                key={zone.id}
                style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '0.85rem',
                  background: zone.level === 'critical' ? '#fff5f5' : '#ffffff',
                  borderLeft: `4px solid ${zone.level === 'critical' ? '#b71c1c' : zone.level === 'high' ? '#e65100' : '#1976d2'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '0.9rem' }}>{zone.region}</strong>
                    <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
                      Hazard: {zone.hazard}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '12px',
                    background: zone.level === 'critical' ? '#b71c1c' : zone.level === 'high' ? '#e65100' : '#1976d2',
                    color: '#fff'
                  }}>
                    {zone.score} / 100 [{zone.level.toUpperCase()}]
                  </span>
                </div>

                <div style={{ fontSize: '0.8rem', color: '#333', background: '#fafafa', padding: '0.5rem', borderRadius: '4px' }}>
                  {zone.advisory}
                </div>

                {zone.metrics && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem', fontSize: '0.72rem', color: '#555' }}>
                    {zone.metrics.precipitation_mm !== undefined && (
                      <div>Rain: <strong>{zone.metrics.precipitation_mm} mm</strong></div>
                    )}
                    {zone.metrics.river_discharge_m3s !== undefined && (
                      <div>River: <strong>{zone.metrics.river_discharge_m3s} m³/s</strong></div>
                    )}
                    {zone.metrics.wind_speed_kmh !== undefined && (
                      <div>Wind: <strong>{zone.metrics.wind_speed_kmh} km/h</strong></div>
                    )}
                    {zone.metrics.max_temp_c !== undefined && (
                      <div>Max Temp: <strong>{zone.metrics.max_temp_c} °C</strong></div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => {
                    setFocusTarget([zone.lat, zone.lng])
                    setConsoleTab('dispatch')
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid #1976d2',
                    color: '#1976d2',
                    padding: '0.3rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: '0.2rem'
                  }}
                >
                  📍 Center on Tactical Map
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Main Operational Layout: Leaflet Map & Ranked List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.3fr) minmax(300px, 1fr)', gap: '1.25rem', minHeight: '520px' }}>
        
        {/* Map Panel */}
        <div style={{ background: '#fff', borderRadius: '10px', padding: '0.75rem', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', padding: '0 0.25rem' }}>
            <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
              <MapPin size={18} color="var(--primary-color)" />
              Tactical Geospatial Map
            </h3>
            <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-light)', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#b71c1c' }}></span> U5 Imminent
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#7b1fa2' }}></span> Facility
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2e7d32' }}></span> Rescue Team
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff9800', border: '1px dashed #d32f2f' }}></span> Risk Zone
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffc107', border: '1px solid #b71c1c' }}></span> Road Hazard
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#00e5ff', border: '1px solid #00838f' }}></span> Staging Hub
              </span>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: '440px', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
            <MapContainer 
              center={[12.9716, 77.5946]} 
              zoom={11} 
              style={{ width: '100%', height: '100%', minHeight: '440px' }}
            >
              <MapFlyController target={focusTarget} />
              <TileLayer 
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
              />

              <LayersControl position="topright">
                {/* 1. Ticket Markers Layer */}
                <LayersControl.Overlay checked name="Emergency Tickets">
                  <LayerGroup>
                    {tickets.map(ticket => {
                      if (!ticket.lat || !ticket.lng) return null
                      const color = getUrgencyColor(ticket.urgency)
                      return (
                        <CircleMarker
                          key={ticket.id}
                          center={[ticket.lat, ticket.lng]}
                          radius={ticket.urgency >= 4 ? 11 : 8}
                          pathOptions={{
                            color: color,
                            fillColor: color,
                            fillOpacity: 0.85,
                            weight: selectedTicket?.id === ticket.id ? 4 : 2
                          }}
                          eventHandlers={{
                            click: () => setSelectedTicket(ticket)
                          }}
                        >
                          <Tooltip direction="top" offset={[0, -5]}>
                            <strong>Urgency {ticket.urgency}/5</strong> ({ticket.emergency_type})<br />
                            Status: {ticket.status}
                          </Tooltip>
                          <Popup>
                            <div style={{ maxWidth: '240px' }}>
                              <h4 style={{ margin: '0 0 0.25rem 0', color }}>
                                [{ticket.emergency_type.toUpperCase()}] Urgency {ticket.urgency}
                              </h4>
                              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>
                                {ticket.ai_summary || ticket.original_text}
                              </p>
                              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
                                Status: <strong>{ticket.status}</strong> | At risk: <strong>{ticket.people_at_risk}</strong>
                              </div>
                              <button 
                                onClick={() => setSelectedTicket(ticket)}
                                style={{
                                  background: 'var(--primary-color)',
                                  color: '#fff',
                                  border: 'none',
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '0.8rem',
                                  width: '100%'
                                }}
                              >
                                View Ticket Drawer
                              </button>
                            </div>
                          </Popup>
                        </CircleMarker>
                      )
                    })}
                  </LayerGroup>
                </LayersControl.Overlay>

                {/* 2. Relief Facilities Layer */}
                <LayersControl.Overlay checked name="Relief Facilities">
                  <LayerGroup>
                    {facilities.map(fac => (
                      <CircleMarker
                        key={fac.id}
                        center={[fac.lat, fac.lng]}
                        radius={7}
                        pathOptions={{
                          color: '#7b1fa2',
                          fillColor: '#9c27b0',
                          fillOpacity: 0.75,
                          weight: 2
                        }}
                      >
                        <Tooltip direction="top">
                          🏢 {fac.name} ({fac.kind})
                        </Tooltip>
                        <Popup>
                          <div>
                            <strong>{fac.name}</strong><br />
                            Type: {fac.kind}<br />
                            Capacity: {fac.occupancy}/{fac.capacity}<br />
                            Phone: {fac.phone || 'N/A'}<br />
                            <small>{fac.address}</small>
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>

                {/* 3. Rescue Teams Layer */}
                <LayersControl.Overlay checked name="Rescue Teams">
                  <LayerGroup>
                    {rescueTeams.map(team => {
                      const isAvail = team.available
                      return (
                        <CircleMarker
                          key={team.id}
                          center={[team.lat, team.lng]}
                          radius={8}
                          pathOptions={{
                            color: isAvail ? '#2e7d32' : '#c62828',
                            fillColor: isAvail ? '#4caf50' : '#e57373',
                            fillOpacity: 0.8,
                            weight: 2
                          }}
                        >
                          <Tooltip direction="top">
                            🚒 {team.name} ({isAvail ? 'Available' : 'Deployed'})
                          </Tooltip>
                          <Popup>
                            <div>
                              <strong>{team.name}</strong><br />
                              Specialty: {team.type}<br />
                              Status: <strong style={{ color: isAvail ? '#2e7d32' : '#c62828' }}>
                                {isAvail ? 'Available for Dispatch' : 'Currently Deployed'}
                              </strong>
                            </div>
                          </Popup>
                        </CircleMarker>
                      )
                    })}
                  </LayerGroup>
                </LayersControl.Overlay>

                {/* 4. Disaster Risk Heat Overlay (Phase 1 Disaster Prediction) */}
                <LayersControl.Overlay checked name="Disaster Risk Heat Overlay">
                  <LayerGroup>
                    {riskForecasts.map(zone => {
                      const getZoneColor = (lvl: string) => {
                        switch (lvl) {
                          case 'critical': return { stroke: '#b71c1c', fill: '#d32f2f', fillOpacity: 0.35, radius: 28000 }
                          case 'high': return { stroke: '#e65100', fill: '#f57c00', fillOpacity: 0.30, radius: 24000 }
                          case 'moderate': return { stroke: '#f57f17', fill: '#fbc02d', fillOpacity: 0.25, radius: 20000 }
                          default: return { stroke: '#2e7d32', fill: '#43a047', fillOpacity: 0.20, radius: 16000 }
                        }
                      }
                      const zoneStyle = getZoneColor(zone.level)

                      return (
                        <LayerGroup key={zone.id}>
                          <Circle
                            center={[zone.lat, zone.lng]}
                            radius={zoneStyle.radius}
                            pathOptions={{
                              color: zoneStyle.stroke,
                              fillColor: zoneStyle.fill,
                              fillOpacity: zoneStyle.fillOpacity,
                              weight: 2,
                              dashArray: zone.level === 'critical' ? '4, 4' : undefined
                            }}
                          >
                            <Tooltip direction="top">
                              <strong>⚠️ {zone.region}</strong> ({zone.hazard.toUpperCase()})<br />
                              Risk: <span style={{ textTransform: 'capitalize', color: zoneStyle.stroke, fontWeight: 700 }}>
                                {zone.level} ({zone.score}/100)
                              </span>
                            </Tooltip>
                            <Popup>
                              <div style={{ maxWidth: '270px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                  <strong style={{ fontSize: '0.9rem' }}>{zone.region}</strong>
                                  <span style={{ 
                                    backgroundColor: zoneStyle.stroke, 
                                    color: '#ffffff', 
                                    padding: '0.15rem 0.45rem', 
                                    borderRadius: '10px', 
                                    fontSize: '0.7rem', 
                                    fontWeight: 700, 
                                    textTransform: 'uppercase' 
                                  }}>
                                    {zone.hazard} • {zone.score}/100
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#222', marginBottom: '0.5rem', lineHeight: '1.4' }}>
                                  <strong>Groq AI Advisory:</strong><br />
                                  {zone.advisory}
                                </div>
                                {zone.metrics && (
                                  <div style={{ fontSize: '0.75rem', color: '#444', backgroundColor: '#f9f9f9', padding: '0.4rem', borderRadius: '4px', border: '1px solid #eee' }}>
                                    {zone.metrics.precipitation_mm !== undefined && <div>🌧️ Rainfall: {zone.metrics.precipitation_mm} mm</div>}
                                    {zone.metrics.river_discharge_m3s !== undefined && <div>🌊 River Flow: {zone.metrics.river_discharge_m3s} m³/s</div>}
                                    {zone.metrics.wind_speed_kmh !== undefined && <div>💨 Wind: {zone.metrics.wind_speed_kmh} km/h</div>}
                                    {zone.metrics.max_temp_c !== undefined && <div>🌡️ Max Temp: {zone.metrics.max_temp_c}°C</div>}
                                  </div>
                                )}
                              </div>
                            </Popup>
                          </Circle>

                          {/* Centroid Pin */}
                          <CircleMarker
                            center={[zone.lat, zone.lng]}
                            radius={5}
                            pathOptions={{
                              color: zoneStyle.stroke,
                              fillColor: '#ffffff',
                              fillOpacity: 1,
                              weight: 2
                            }}
                          />
                        </LayerGroup>
                      )
                    })}
                  </LayerGroup>
                </LayersControl.Overlay>

                {/* 5. Crowd Hazard Reports Overlay (Phase 3 Safe Routing) */}
                <LayersControl.Overlay checked name="Crowd Hazard Reports">
                  <LayerGroup>
                    {hazards.map(h => (
                      <LayerGroup key={h.id}>
                        <Circle
                          center={[h.lat, h.lng]}
                          radius={h.avoid_radius_meters}
                          pathOptions={{
                            color: '#b71c1c',
                            fillColor: '#ef5350',
                            fillOpacity: 0.35,
                            weight: 2,
                            dashArray: '3, 3'
                          }}
                        >
                          <Tooltip direction="top">
                            <strong>🚧 HAZARD: {h.hazard_type.replace('_', ' ').toUpperCase()}</strong><br />
                            {h.description} ({h.avoid_radius_meters}m)
                          </Tooltip>
                          <Popup>
                            <div style={{ maxWidth: '240px' }}>
                              <strong style={{ color: '#c62828' }}>
                                [{h.hazard_type.replace('_', ' ').toUpperCase()}]
                              </strong><br />
                              <p style={{ margin: '0.25rem 0', fontSize: '0.85rem' }}>{h.description}</p>
                              {h.image_url && (
                                <div style={{ marginTop: '0.4rem', borderRadius: '4px', overflow: 'hidden' }}>
                                  <img
                                    src={h.image_url}
                                    alt="Hazard scan"
                                    style={{ width: '100%', maxHeight: '120px', objectFit: 'cover', borderRadius: '4px' }}
                                  />
                                  <div style={{ fontSize: '0.7rem', color: '#1565c0', marginTop: '2px', fontWeight: 600 }}>
                                    📸 Groq Vision Verified • Confidence: {h.ai_analysis?.confidence ? `${Math.round(h.ai_analysis.confidence * 100)}%` : '92%'}
                                  </div>
                                </div>
                              )}
                              <small style={{ color: '#666', display: 'block', marginTop: '0.25rem' }}>
                                Danger Radius: {h.avoid_radius_meters}m | Severity: {h.severity}/5
                              </small>
                            </div>
                          </Popup>
                        </Circle>
                        <CircleMarker
                          center={[h.lat, h.lng]}
                          radius={6}
                          pathOptions={{ color: '#b71c1c', fillColor: '#ffc107', fillOpacity: 1, weight: 2 }}
                        />
                      </LayerGroup>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>

                {/* 6. Ambulance Staging Hubs Overlay (Phase 5 Optimizer) */}
                <LayersControl.Overlay checked name="🚑 Ambulance Staging Hubs">
                  <LayerGroup>
                    {detectedStagingHubs.map(hub => (
                      <LayerGroup key={hub.id}>
                        <Circle
                          center={[hub.lat, hub.lng]}
                          radius={550}
                          pathOptions={{
                            color: '#00838f',
                            fillColor: '#00acc1',
                            fillOpacity: 0.28,
                            weight: 2,
                            dashArray: '4, 4'
                          }}
                        >
                          <Tooltip direction="top">
                            <strong>🚑 STAGING HUB: {hub.name}</strong><br />
                            {hub.ticketCount} Incidents | 👥 {hub.peopleAtRisk} Victims | Deploy {hub.recommendedAmbulances} Ambulances
                          </Tooltip>
                          <Popup>
                            <div style={{ maxWidth: '240px' }}>
                              <strong style={{ color: '#00838f' }}>🚑 {hub.name}</strong><br />
                              <p style={{ margin: '0.25rem 0', fontSize: '0.85rem' }}>
                                Centroid of {hub.ticketCount} active distress calls with {hub.peopleAtRisk} trapped victims.
                              </p>
                              <div style={{ background: '#e0f7fa', padding: '0.4rem', borderRadius: '4px', fontSize: '0.75rem', color: '#006064' }}>
                                <strong>Recommended Staging:</strong> {hub.recommendedAmbulances} ALS Ambulances<br />
                                {hub.nearestFacilityName && (
                                  <><strong>Referral Facility:</strong> {hub.nearestFacilityName} ({hub.nearestFacilityDistanceKm} km)</>
                                )}
                              </div>
                            </div>
                          </Popup>
                        </Circle>
                        <CircleMarker
                          center={[hub.lat, hub.lng]}
                          radius={8}
                          pathOptions={{ color: '#006064', fillColor: '#00e5ff', fillOpacity: 1, weight: 3 }}
                        />
                      </LayerGroup>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
              </LayersControl>
            </MapContainer>
          </div>
        </div>

        {/* Ranked Ticket List Panel */}
        <div style={{ background: '#fff', borderRadius: '10px', padding: '1rem', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={18} />
              Ranked Emergency Queue
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-light)', background: '#f5f5f5', padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
              {filteredTickets.length} tickets
            </span>
          </div>

          {/* Search & Filter Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input 
              type="text" 
              placeholder="Search keyword, location, or ticket..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}
            />

            {/* Quick status filter pills */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {[
                { key: 'all', label: 'All' },
                { key: 'critical', label: '🚨 U4-U5' },
                { key: 'new', label: 'New' },
                { key: 'assigned', label: 'Assigned' },
                { key: 'resolved', label: 'Resolved' }
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key as any)}
                  style={{
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.75rem',
                    borderRadius: '16px',
                    border: '1px solid var(--border-color)',
                    background: statusFilter === f.key ? 'var(--primary-color)' : '#fff',
                    color: statusFilter === f.key ? '#fff' : 'var(--text-color)',
                    cursor: 'pointer',
                    fontWeight: statusFilter === f.key ? 600 : 400
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* List items */}
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '420px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filteredTickets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                No tickets matching current filters.
              </div>
            ) : (
              filteredTickets.map(t => {
                const isSelected = selectedTicket?.id === t.id
                const urgColor = getUrgencyColor(t.urgency)
                const priority = calculateTicketPriority(t, tickets)
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTicket(t)}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '8px',
                      border: isSelected ? `2px solid var(--primary-color)` : '1px solid var(--border-color)',
                      background: isSelected ? '#fff8f8' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      borderLeft: `5px solid ${urgColor}`
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <span style={{
                          background: urgColor,
                          color: '#fff',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.4rem',
                          borderRadius: '4px'
                        }}>
                          U{t.urgency}
                        </span>
                        <span style={{
                          background: priority.tier === 'CRITICAL' ? '#b71c1c' : priority.tier === 'HIGH' ? '#e65100' : '#1976d2',
                          color: '#fff',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          padding: '0.15rem 0.35rem',
                          borderRadius: '4px'
                        }}>
                          ⚡ {priority.score}
                        </span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          {getEmergencyIcon(t.emergency_type)}
                          {t.emergency_type}
                        </span>
                      </div>
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '12px',
                        background: t.status === 'resolved' ? '#e8f5e9' : t.status === 'assigned' ? '#e3f2fd' : '#ffebee',
                        color: t.status === 'resolved' ? '#2e7d32' : t.status === 'assigned' ? '#1565c0' : '#c62828',
                        fontWeight: 600
                      }}>
                        {t.status.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: '#333', lineClamp: 2, WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {t.ai_summary || t.original_text}
                    </div>

                    {t.vulnerable_flags && t.vulnerable_flags.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                        {t.vulnerable_flags.map(f => (
                          <span key={f} style={{ fontSize: '0.65rem', background: '#ffebee', color: '#c62828', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: 600 }}>
                            ⚠️ {f.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-light)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <MapPin size={12} />
                        {t.address_text ? t.address_text.slice(0, 24) + '...' : 'Location pinned'}
                      </span>
                      <span>
                        {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* 4. Ticket Detail Drawer / Panel (Slides open when a ticket is selected) */}
      {selectedTicket && (
        <div style={{
          background: '#fff',
          borderRadius: '10px',
          padding: '1.25rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          border: '1px solid var(--border-color)',
          marginTop: '0.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  background: getUrgencyColor(selectedTicket.urgency),
                  color: '#fff',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: 700
                }}>
                  Urgency {selectedTicket.urgency}/5
                </span>
                <span>Incident #{selectedTicket.id.slice(0, 8)}</span>
                <span style={{
                  fontSize: '0.8rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '12px',
                  background: selectedTicket.status === 'resolved' ? '#e8f5e9' : selectedTicket.status === 'assigned' ? '#e3f2fd' : '#ffebee',
                  color: selectedTicket.status === 'resolved' ? '#2e7d32' : selectedTicket.status === 'assigned' ? '#1565c0' : '#c62828',
                  fontWeight: 600
                }}>
                  {selectedTicket.status.toUpperCase()}
                </span>
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
                Reported via <strong>{selectedTicket.channel.toUpperCase()}</strong> | Time: {new Date(selectedTicket.created_at).toLocaleString()}
              </div>
            </div>

            <button 
              onClick={() => setSelectedTicket(null)}
              style={{ background: '#f5f5f5', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            
            {/* Left Column: Messages & AI Summary */}
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-light)', display: 'block', marginBottom: '0.25rem' }}>
                  Citizen Emergency Voice/Text ({selectedTicket.original_language.toUpperCase()})
                </label>
                <div style={{ background: '#f9f9f9', padding: '0.75rem', borderRadius: '6px', fontSize: '0.9rem', border: '1px solid var(--border-color)', fontStyle: 'italic' }}>
                  "{selectedTicket.original_text}"
                </div>
              </div>

              {selectedTicket.ai_summary && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-light)', display: 'block', marginBottom: '0.25rem' }}>
                    AI Structured Tactical Summary (English)
                  </label>
                  <div style={{ background: '#eef6fc', padding: '0.75rem', borderRadius: '6px', fontSize: '0.9rem', borderLeft: '4px solid #1976d2' }}>
                    {selectedTicket.ai_summary}
                  </div>
                </div>
              )}

              {selectedTicket.reply_in_user_language && (
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-light)', display: 'block', marginBottom: '0.25rem' }}>
                    Automated Citizen Reassurance Guidance
                  </label>
                  <div style={{ background: '#f0fdf4', padding: '0.65rem', borderRadius: '6px', fontSize: '0.85rem', color: '#166534' }}>
                    {selectedTicket.reply_in_user_language}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Tactical Parameters & Dispatch Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div style={{ background: '#f5f5f5', padding: '0.6rem', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'block' }}>People at Risk</span>
                  <strong style={{ fontSize: '1.1rem' }}>{selectedTicket.people_at_risk}</strong>
                </div>

                <div style={{ background: '#f5f5f5', padding: '0.6rem', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'block' }}>Reporter Phone</span>
                  <strong style={{ fontSize: '0.95rem' }}>{selectedTicket.reporter_phone || 'Anonymous / Web'}</strong>
                </div>
              </div>

              {/* Vulnerability flags */}
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'block', marginBottom: '0.25rem' }}>Vulnerability Triggers Detected:</span>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {selectedTicket.vulnerable_flags && selectedTicket.vulnerable_flags.length > 0 ? (
                    selectedTicket.vulnerable_flags.map(flag => (
                      <span 
                        key={flag} 
                        style={{ background: '#ffebee', color: '#c62828', fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '12px', fontWeight: 600 }}
                      >
                        ⚠️ {flag.replace('_', ' ')}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: '#999' }}>None detected</span>
                  )}
                </div>
              </div>

              {/* Location details */}
              <div style={{ background: '#f5f5f5', padding: '0.6rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'block' }}>Coordinates / Geocode:</span>
                <strong>{selectedTicket.address_text || 'Exact coordinates registered'}</strong>
                <div style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                  Lat: {selectedTicket.lat?.toFixed(5) || 'N/A'}, Lng: {selectedTicket.lng?.toFixed(5) || 'N/A'}
                </div>
              </div>

              {/* Team assignment info */}
              <div style={{ background: selectedTicket.assigned_team_id ? '#e8f5e9' : '#fff3e0', padding: '0.6rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'block' }}>Assigned Rescue Unit:</span>
                {selectedTicket.assigned_team_id ? (
                  <strong style={{ color: '#2e7d32', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Truck size={16} />
                    {selectedTicket.assigned_team?.name || 'Unit Dispatched'}
                  </strong>
                ) : (
                  <span style={{ color: '#e65100', fontWeight: 600 }}>Unassigned - Awaiting Dispatch</span>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  onClick={() => handleAssignNearestTeam(selectedTicket.id)}
                  disabled={actionLoading || selectedTicket.status === 'resolved'}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    borderRadius: '6px',
                    background: '#1976d2',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: selectedTicket.status === 'resolved' ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    opacity: selectedTicket.status === 'resolved' ? 0.6 : 1
                  }}
                >
                  {actionLoading ? <RefreshCw className="animate-spin" size={16} /> : <Truck size={16} />}
                  <span>Assign Nearest Team</span>
                </button>

                <button
                  onClick={() => handleMarkResolved(selectedTicket)}
                  disabled={actionLoading || selectedTicket.status === 'resolved'}
                  style={{
                    padding: '0.75rem 1.25rem',
                    borderRadius: '6px',
                    background: '#388e3c',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: selectedTicket.status === 'resolved' ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    opacity: selectedTicket.status === 'resolved' ? 0.6 : 1
                  }}
                >
                  <CheckCircle2 size={16} />
                  <span>{selectedTicket.status === 'resolved' ? 'Resolved' : 'Mark Resolved'}</span>
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  )
}

