export interface HazardReport {
  id: string
  hazard_type: 'flooded_road' | 'blocked_path' | 'collapsed_bridge' | 'fallen_tree' | 'power_cable' | 'fire_smoke' | string
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

export interface RouteResult {
  coordinates: [number, number][] // [lat, lng] pairs for Leaflet Polyline
  distanceKm: number
  durationMin: number
  hazardsOnRoute: HazardReport[]
  isSafe: boolean
  detourApplied: boolean
  steps: string[]
}

// Distance helper: Haversine distance in meters
export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Check minimum distance from a hazard to the route polyline
export function minDistanceToRoute(hazardLat: number, hazardLng: number, coords: [number, number][]): number {
  if (coords.length === 0) return Infinity
  let minD = Infinity
  for (let i = 0; i < coords.length; i++) {
    const d = haversineDistanceMeters(hazardLat, hazardLng, coords[i][0], coords[i][1])
    if (d < minD) minD = d

    // Also check midpoints between segments for long steps
    if (i < coords.length - 1) {
      const midLat = (coords[i][0] + coords[i + 1][0]) / 2
      const midLng = (coords[i][1] + coords[i + 1][1]) / 2
      const dMid = haversineDistanceMeters(hazardLat, hazardLng, midLat, midLng)
      if (dMid < minD) minD = dMid
    }
  }
  return minD
}

// Find all hazards that intersect the route within their avoid radius
export function findHazardsOnRoute(coords: [number, number][], hazards: HazardReport[]): HazardReport[] {
  const activeHazards = hazards.filter(h => h.is_active)
  const intersected: HazardReport[] = []

  for (const h of activeHazards) {
    const dist = minDistanceToRoute(h.lat, h.lng, coords)
    if (dist <= h.avoid_radius_meters) {
      intersected.push(h)
    }
  }

  return intersected
}

// Compute detour waypoint perpendicular to hazard
export function computeDetourWaypoint(
  hazard: HazardReport,
  start: [number, number],
  end: [number, number]
): { lat: number; lng: number } {
  // Vector from start to end
  const dx = end[1] - start[1]
  const dy = end[0] - start[0]
  const len = Math.sqrt(dx * dx + dy * dy) || 0.001

  // Normal vector perpendicular
  const nx = -dy / len
  const ny = dx / len

  // Shift by avoid_radius + 150m buffer in degrees (~111km per deg lat, ~100km per deg lng)
  const offsetMeters = hazard.avoid_radius_meters + 150
  const latOffset = (ny * offsetMeters) / 111000
  const lngOffset = (nx * offsetMeters) / 100000

  return {
    lat: hazard.lat + latOffset,
    lng: hazard.lng + lngOffset
  }
}

/**
 * Fetch public OSRM route between two points (with optional avoid waypoint)
 * Free tier, zero API keys, OpenStreetMap data
 */
export async function getSafeRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  hazards: HazardReport[] = [],
  avoidHazards: boolean = true
): Promise<RouteResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  let coordinates: [number, number][] = []
  let distanceKm = 0
  let durationMin = 0
  let steps: string[] = []

  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`
    const resp = await fetch(osrmUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (resp.ok) {
      const data = await resp.json()
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0]
        distanceKm = Math.round((route.distance / 1000) * 10) / 10
        durationMin = Math.round(route.duration / 60)
        
        // GeoJSON gives coordinates as [lng, lat], convert to Leaflet [lat, lng]
        coordinates = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]])

        if (route.legs?.[0]?.steps) {
          steps = route.legs[0].steps
            .map((s: any) => s.maneuver?.instruction || s.name)
            .filter((t: string) => Boolean(t) && t !== '')
        }
      }
    }
  } catch (e) {
    console.warn('OSRM public router call timed out or failed, using geometric interpolation:', e)
  }

  // Fallback if OSRM service is unavailable or in offline testing
  if (coordinates.length === 0) {
    const numPoints = 12
    for (let i = 0; i <= numPoints; i++) {
      const ratio = i / numPoints
      coordinates.push([
        startLat + (endLat - startLat) * ratio,
        startLng + (endLng - startLng) * ratio
      ])
    }
    const distMeters = haversineDistanceMeters(startLat, startLng, endLat, endLng)
    distanceKm = Math.round((distMeters / 1000) * 10) / 10
    durationMin = Math.max(1, Math.round(distanceKm * 2.5))
    steps = ['Proceed towards destination on main corridor', 'Arrive at designated facility safe zone']
  }

  // 1. Check for intersecting hazards
  let hazardsOnRoute = findHazardsOnRoute(coordinates, hazards)
  let detourApplied = false

  // 2. If hazards exist and avoidHazards is enabled, compute detour via waypoint
  if (hazardsOnRoute.length > 0 && avoidHazards) {
    const primaryHazard = hazardsOnRoute[0]
    const detourPoint = computeDetourWaypoint(primaryHazard, [startLat, startLng], [endLat, endLng])

    try {
      const detourUrl = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${detourPoint.lng},${detourPoint.lat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`
      const dResp = await fetch(detourUrl)
      if (dResp.ok) {
        const dData = await dResp.json()
        if (dData.routes && dData.routes.length > 0) {
          const dRoute = dData.routes[0]
          const detourCoords: [number, number][] = dRoute.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]])
          const remainingHazards = findHazardsOnRoute(detourCoords, hazards)

          // Accept detour if it reduces or clears hazards
          if (remainingHazards.length < hazardsOnRoute.length) {
            coordinates = detourCoords
            distanceKm = Math.round((dRoute.distance / 1000) * 10) / 10
            durationMin = Math.round(dRoute.duration / 60)
            hazardsOnRoute = remainingHazards
            detourApplied = true
            steps.unshift(`Detour applied: Bypassing ${primaryHazard.description}`)
          }
        }
      }
    } catch (e) {
      console.warn('Detour route calculation error:', e)
    }
  }

  return {
    coordinates,
    distanceKm,
    durationMin,
    hazardsOnRoute,
    isSafe: hazardsOnRoute.length === 0,
    detourApplied,
    steps
  }
}

