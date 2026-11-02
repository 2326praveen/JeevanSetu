// =====================================================================
// JeevanSetu AI - Rescue Resource Optimizer Utility
// Priority Scoring, Greedy Nearest Dispatch, Ambulance Staging Centroids,
// and Shelter Occupancy Load Balancing
// =====================================================================

import { Ticket, RescueTeam, Facility } from '../screens/AdminScreen'
import { haversineDistanceMeters } from './routing'

export interface PriorityBreakdown {
  base: number
  vulnerability: number
  waiting: number
  cluster: number
}

export interface TicketPriorityResult {
  ticketId: string
  score: number
  tier: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  breakdown: PriorityBreakdown
  nearbyCount: number
  waitMinutes: number
}

export interface StagingPosition {
  id: string
  name: string
  lat: number
  lng: number
  ticketCount: number
  peopleAtRisk: number
  criticalCount: number
  recommendedAmbulances: number
  nearestFacilityName?: string
  nearestFacilityDistanceKm?: number
  ticketIds: string[]
}

export interface AssignmentSuggestion {
  ticketId: string
  ticketSummary: string
  emergencyType: string
  urgency: number
  peopleAtRisk: number
  vulnerableFlags: string[]
  priorityScore: number
  priorityTier: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  teamId: string
  teamName: string
  teamType: string
  distanceKm: number
  estimatedEtaMin: number
  rationale: string
}

export interface ShelterAnalysis {
  facilityId: string
  name: string
  kind: string
  lat: number
  lng: number
  capacity: number
  occupancy: number
  utilizationPct: number
  status: 'critical' | 'moderate' | 'optimal'
  recommendedDiversion?: {
    targetFacilityId: string
    targetName: string
    availableCapacity: number
    distanceKm: number
  }
}

// 1. Calculate Priority Score for a Single Ticket
export function calculateTicketPriority(ticket: Ticket, allTickets: Ticket[]): TicketPriorityResult {
  const urgency = ticket.urgency || 3
  const baseScore = urgency * 20 // 20 to 100

  // Vulnerability bonus: +15 per flag, +5 per person at risk (capped at 25)
  const flags = ticket.vulnerable_flags || []
  let vulnBonus = flags.length * 15
  if (flags.some(f => ['infant', 'pregnant', 'child'].includes(f.toLowerCase()))) {
    vulnBonus += 10 // Extra weight for infants & maternal emergencies
  }
  const peopleBonus = Math.min(25, (ticket.people_at_risk || 1) * 5)
  const totalVuln = vulnBonus + peopleBonus

  // Waiting time bonus: 1.5 points per minute waiting, max 60 points
  const createdTime = new Date(ticket.created_at || Date.now()).getTime()
  const waitMinutes = Math.max(0, Math.floor((Date.now() - createdTime) / 60000))
  const waitBonus = Math.min(60, Math.round(waitMinutes * 1.5))

  // Spatial cluster count: other active tickets within 1.5 km
  let nearbyCount = 0
  if (ticket.lat && ticket.lng) {
    for (const other of allTickets) {
      if (other.id !== ticket.id && other.status !== 'resolved' && other.lat && other.lng) {
        const meters = haversineDistanceMeters(ticket.lat, ticket.lng, other.lat, other.lng)
        if (meters <= 1500) {
          nearbyCount++
        }
      }
    }
  }
  const clusterBonus = Math.min(40, nearbyCount * 10)

  const totalScore = Math.round((baseScore + totalVuln + waitBonus + clusterBonus) * 10) / 10

  let tier: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW'
  if (totalScore >= 110) tier = 'CRITICAL'
  else if (totalScore >= 85) tier = 'HIGH'
  else if (totalScore >= 55) tier = 'MEDIUM'

  return {
    ticketId: ticket.id,
    score: totalScore,
    tier,
    breakdown: {
      base: baseScore,
      vulnerability: totalVuln,
      waiting: waitBonus,
      cluster: clusterBonus
    },
    nearbyCount,
    waitMinutes
  }
}

// 2. Greedy Nearest Matching with Skill & Compatibility Alignment
export function computeOptimizedAssignments(
  tickets: Ticket[],
  teams: RescueTeam[]
): AssignmentSuggestion[] {
  // Only target unassigned active tickets
  const unassigned = tickets.filter(t => t.status === 'new' && !t.assigned_team_id)
  if (unassigned.length === 0) return []

  // Score and sort tickets descending
  const scored = unassigned.map(t => ({
    ticket: t,
    priority: calculateTicketPriority(t, tickets)
  })).sort((a, b) => b.priority.score - a.priority.score)

  const availableTeams = teams.filter(t => t.available)
  if (availableTeams.length === 0) return []

  const remainingTeams = [...availableTeams]
  const suggestions: AssignmentSuggestion[] = []

  for (const item of scored) {
    if (remainingTeams.length === 0) break
    const t = item.ticket
    const tLat = t.lat ?? 12.9716
    const tLng = t.lng ?? 77.5946

    const emergencyType = (t.emergency_type || '').toLowerCase()
    const summary = (t.ai_summary || t.original_text || '').toLowerCase()

    // Determine ideal team specialization
    let preferredType = ''
    if (emergencyType.includes('flood') || summary.includes('flood') || summary.includes('water') || summary.includes('drown')) {
      preferredType = 'ndrf_boat'
    } else if (emergencyType.includes('medical') || summary.includes('pregnant') || summary.includes('infant') || summary.includes('cardiac') || summary.includes('injur')) {
      preferredType = 'ambulance'
    } else if (emergencyType.includes('fire') || summary.includes('smoke') || summary.includes('gas') || summary.includes('trapped') || summary.includes('collapse')) {
      preferredType = 'fire_rescue'
    }

    // Rank available teams by composite cost: distance with bonus if specialized
    let bestIdx = -1
    let bestScore = Infinity
    let bestDistKm = 0

    for (let i = 0; i < remainingTeams.length; i++) {
      const team = remainingTeams[i]
      const distMeters = haversineDistanceMeters(tLat, tLng, team.lat, team.lng)
      const distKm = distMeters / 1000

      // Distance penalty
      let effectiveCost = distKm

      // Specialization discount
      const teamType = (team.type || '').toLowerCase()
      if (preferredType && teamType.includes(preferredType.replace('_', ''))) {
        effectiveCost *= 0.5 // 50% distance advantage for specialized team
      } else if (preferredType === 'ambulance' && teamType.includes('medical')) {
        effectiveCost *= 0.6
      }

      if (effectiveCost < bestScore) {
        bestScore = effectiveCost
        bestIdx = i
        bestDistKm = distKm
      }
    }

    if (bestIdx >= 0) {
      const chosenTeam = remainingTeams[bestIdx]
      remainingTeams.splice(bestIdx, 1)

      const roundDist = Math.round(bestDistKm * 10) / 10
      const etaMin = Math.max(3, Math.round(roundDist * 2.2 + 3))

      let rationale = `Closest available unit (${roundDist} km, ~${etaMin} min ETA).`
      if (preferredType && chosenTeam.type.toLowerCase().includes(preferredType.replace('_', ''))) {
        rationale = `Specialized ${chosenTeam.type.toUpperCase()} matched to high-severity ${t.emergency_type} (${roundDist} km).`
      } else if (item.priority.tier === 'CRITICAL') {
        rationale = `CRITICAL priority distress dispatch (${item.priority.score} pts, ${t.people_at_risk} victims).`
      }

      suggestions.push({
        ticketId: t.id,
        ticketSummary: t.ai_summary || t.original_text || 'Emergency distress call',
        emergencyType: t.emergency_type,
        urgency: t.urgency,
        peopleAtRisk: t.people_at_risk,
        vulnerableFlags: t.vulnerable_flags || [],
        priorityScore: item.priority.score,
        priorityTier: item.priority.tier,
        teamId: chosenTeam.id,
        teamName: chosenTeam.name,
        teamType: chosenTeam.type,
        distanceKm: roundDist,
        estimatedEtaMin: etaMin,
        rationale
      })
    }
  }

  return suggestions
}

// 3. Ambulance Staging Hubs & Cluster Centroid Detection
export function detectAmbulanceStagingHubs(
  tickets: Ticket[],
  facilities: Facility[] = []
): StagingPosition[] {
  const activeTickets = tickets.filter(t => t.status !== 'resolved' && t.lat && t.lng)
  if (activeTickets.length === 0) return []

  const visited = new Set<string>()
  const clusters: Ticket[][] = []

  // Simple spatial grouping: radius 2.0 km
  for (let i = 0; i < activeTickets.length; i++) {
    const t1 = activeTickets[i]
    if (visited.has(t1.id)) continue

    const currentCluster: Ticket[] = [t1]
    visited.add(t1.id)

    for (let j = i + 1; j < activeTickets.length; j++) {
      const t2 = activeTickets[j]
      if (visited.has(t2.id)) continue

      const d = haversineDistanceMeters(t1.lat!, t1.lng!, t2.lat!, t2.lng!)
      if (d <= 2000) {
        currentCluster.push(t2)
        visited.add(t2.id)
      }
    }

    if (currentCluster.length >= 2) {
      clusters.push(currentCluster)
    }
  }

  const hospitals = facilities.filter(f => f.kind === 'hospital')

  return clusters.map((cluster, idx) => {
    const totalLat = cluster.reduce((sum, t) => sum + (t.lat || 0), 0)
    const totalLng = cluster.reduce((sum, t) => sum + (t.lng || 0), 0)
    const centLat = totalLat / cluster.length
    const centLng = totalLng / cluster.length

    const totalPeople = cluster.reduce((sum, t) => sum + (t.people_at_risk || 1), 0)
    const critCount = cluster.filter(t => t.urgency >= 4).length
    const ambulances = Math.max(1, Math.ceil(totalPeople / 4))

    // Nearest hospital referral
    let nearestHosp: Facility | undefined
    let minHospDist = Infinity
    for (const h of hospitals) {
      const d = haversineDistanceMeters(centLat, centLng, h.lat, h.lng) / 1000
      if (d < minHospDist) {
        minHospDist = d
        nearestHosp = h
      }
    }

    const firstAddress = cluster.find(t => t.address_text)?.address_text || `Sector ${idx + 1}`
    const shortArea = firstAddress.split(',')[0].trim()

    return {
      id: `staging-${idx + 1}`,
      name: `${shortArea} Rapid Staging Hub`,
      lat: Math.round(centLat * 10000) / 10000,
      lng: Math.round(centLng * 10000) / 10000,
      ticketCount: cluster.length,
      peopleAtRisk: totalPeople,
      criticalCount: critCount,
      recommendedAmbulances: ambulances,
      nearestFacilityName: nearestHosp?.name,
      nearestFacilityDistanceKm: nearestHosp ? Math.round(minHospDist * 10) / 10 : undefined,
      ticketIds: cluster.map(t => t.id)
    }
  })
}

// 4. Shelter Occupancy & Diversion Load Balancing
export function analyzeShelterOccupancy(facilities: Facility[]): ShelterAnalysis[] {
  const shelters = facilities.filter(f => f.kind === 'shelter' || f.kind === 'relief_center')
  if (shelters.length === 0) return []

  const results: ShelterAnalysis[] = []

  for (const s of shelters) {
    const capacity = Math.max(1, s.capacity)
    const occupancy = Math.max(0, s.occupancy || 0)
    const utilPct = Math.round((occupancy / capacity) * 1000) / 10

    let status: 'critical' | 'moderate' | 'optimal' = 'optimal'
    if (utilPct >= 85) status = 'critical'
    else if (utilPct >= 60) status = 'moderate'

    let diversion: ShelterAnalysis['recommendedDiversion']

    // If shelter is critical (>85%), find closest underutilized shelter (<60%) within 15 km
    if (status === 'critical') {
      let candidate: Facility | undefined
      let candidateDist = Infinity

      for (const other of shelters) {
        if (other.id !== s.id) {
          const otherUtil = (other.occupancy || 0) / Math.max(1, other.capacity)
          if (otherUtil < 0.6) {
            const distKm = haversineDistanceMeters(s.lat, s.lng, other.lat, other.lng) / 1000
            if (distKm < candidateDist && distKm <= 15) {
              candidateDist = distKm
              candidate = other
            }
          }
        }
      }

      if (candidate) {
        diversion = {
          targetFacilityId: candidate.id,
          targetName: candidate.name,
          availableCapacity: Math.max(0, candidate.capacity - candidate.occupancy),
          distanceKm: Math.round(candidateDist * 10) / 10
        }
      }
    }

    results.push({
      facilityId: s.id,
      name: s.name,
      kind: s.kind,
      lat: s.lat,
      lng: s.lng,
      capacity,
      occupancy,
      utilizationPct: utilPct,
      status,
      recommendedDiversion: diversion
    })
  }

  return results
}

