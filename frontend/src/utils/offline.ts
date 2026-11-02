// =====================================================================
// JeevanSetu AI - Offline Engine Utilities
// SMS-SOS compact encoder, IndexedDB queue manager with sync,
// map tile cache orchestrator, and connectivity monitor
// =====================================================================

import { set, get, del } from 'idb-keyval'

// ===================== SMS-SOS Compact Encoder =====================

// Emergency type codes (2-char shorthand for SMS)
const EMERGENCY_CODES: Record<string, string> = {
  flood: 'FL',
  fire: 'FI',
  earthquake: 'EQ',
  cyclone: 'CY',
  landslide: 'LS',
  medical: 'MD',
  collapse: 'CL',
  trapped: 'TR',
  drowning: 'DR',
  other: 'OT'
}

/**
 * Encode SOS data into a compact SMS-safe string.
 * Format: JSETU|<lat6>,<lng6>|<code>|<people>|<flags>|<msg30>
 * Example: JSETU|12.9716,77.5946|FL|4|ELD,INF|Water 3ft house trapped
 */
export function encodeSmsPayload(opts: {
  lat?: number | null
  lng?: number | null
  emergencyType?: string
  peopleAtRisk?: number
  vulnerableFlags?: string[]
  message?: string
}): string {
  const lat = opts.lat != null ? opts.lat.toFixed(4) : '0'
  const lng = opts.lng != null ? opts.lng.toFixed(4) : '0'

  const type = opts.emergencyType?.toLowerCase() || 'other'
  const code = EMERGENCY_CODES[type] || 'OT'

  const people = Math.min(99, opts.peopleAtRisk || 1)

  // Compact vulnerability flags
  const flagMap: Record<string, string> = {
    elderly: 'ELD', infant: 'INF', child: 'CHD', pregnant: 'PRG',
    disabled: 'DIS', medical_condition: 'MED'
  }
  const flags = (opts.vulnerableFlags || [])
    .map(f => flagMap[f.toLowerCase()] || f.slice(0, 3).toUpperCase())
    .join(',')

  // Truncate message to 30 chars for SMS constraints
  const msg = (opts.message || 'SOS').replace(/[|]/g, ' ').slice(0, 30).trim()

  return `JSETU|${lat},${lng}|${code}|${people}|${flags}|${msg}`
}

/**
 * Decode a compact SMS payload back into structured data.
 */
export function decodeSmsPayload(sms: string): {
  lat: number
  lng: number
  emergencyCode: string
  peopleAtRisk: number
  flags: string[]
  message: string
} | null {
  if (!sms.startsWith('JSETU|')) return null

  const parts = sms.split('|')
  if (parts.length < 6) return null

  const [latStr, lngStr] = parts[1].split(',')
  return {
    lat: parseFloat(latStr) || 0,
    lng: parseFloat(lngStr) || 0,
    emergencyCode: parts[2],
    peopleAtRisk: parseInt(parts[3]) || 1,
    flags: parts[4] ? parts[4].split(',').filter(Boolean) : [],
    message: parts[5] || 'SOS'
  }
}

/**
 * Generate a pre-filled `sms:` URI for the native SMS app.
 * Uses India's emergency SMS gateway number (or fallback 112).
 */
export function generateSmsLink(opts: {
  lat?: number | null
  lng?: number | null
  emergencyType?: string
  peopleAtRisk?: number
  vulnerableFlags?: string[]
  message?: string
  recipientNumber?: string
}): string {
  const body = encodeSmsPayload(opts)
  const recipient = opts.recipientNumber || '112'
  // Standard sms: URI with body parameter
  return `sms:${recipient}?body=${encodeURIComponent(body)}`
}


// ===================== IndexedDB Offline Queue Manager =====================

export const OFFLINE_QUEUE_KEY = 'jeevansetu-sos-queue'
export const OFFLINE_HAZARD_QUEUE_KEY = 'jeevansetu-hazard-queue'
export const OFFLINE_DAMAGE_QUEUE_KEY = 'jeevansetu-damage-queue'

export interface QueuedRequest {
  id: string
  type: 'sos' | 'hazard_report' | 'damage_scan'
  payload: any
  createdAt: string
  retryCount: number
}

/**
 * Add any request to the offline queue.
 */
export async function enqueueOfflineRequest(
  type: QueuedRequest['type'],
  payload: any
): Promise<void> {
  const key = type === 'sos' ? OFFLINE_QUEUE_KEY
    : type === 'hazard_report' ? OFFLINE_HAZARD_QUEUE_KEY
    : OFFLINE_DAMAGE_QUEUE_KEY

  const queue: QueuedRequest[] = (await get(key)) || []
  queue.push({
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0
  })
  await set(key, queue)
}

/**
 * Get all pending offline requests across all queues.
 */
export async function getAllPendingRequests(): Promise<QueuedRequest[]> {
  const sosQueue: QueuedRequest[] = (await get(OFFLINE_QUEUE_KEY)) || []
  const hazardQueue: QueuedRequest[] = (await get(OFFLINE_HAZARD_QUEUE_KEY)) || []
  const damageQueue: QueuedRequest[] = (await get(OFFLINE_DAMAGE_QUEUE_KEY)) || []
  return [...sosQueue, ...hazardQueue, ...damageQueue]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

/**
 * Clear a specific queue after successful sync.
 */
export async function clearQueue(type: QueuedRequest['type']): Promise<void> {
  const key = type === 'sos' ? OFFLINE_QUEUE_KEY
    : type === 'hazard_report' ? OFFLINE_HAZARD_QUEUE_KEY
    : OFFLINE_DAMAGE_QUEUE_KEY
  await del(key)
}

/**
 * Attempt to sync all queued SOS requests. Returns count of successfully synced items.
 */
export async function syncOfflineQueue(
  supabaseUrl: string,
  anonKey: string
): Promise<{ synced: number; failed: number }> {
  const queue: QueuedRequest[] = (await get(OFFLINE_QUEUE_KEY)) || []
  if (queue.length === 0) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0
  const remaining: QueuedRequest[] = []

  for (const req of queue) {
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/create-ticket`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`
          },
          body: JSON.stringify(req.payload)
        }
      )

      if (response.ok) {
        synced++
      } else {
        req.retryCount++
        if (req.retryCount < 3) {
          remaining.push(req)
        }
        failed++
      }
    } catch {
      req.retryCount++
      if (req.retryCount < 3) {
        remaining.push(req)
      }
      failed++
    }
  }

  if (remaining.length > 0) {
    await set(OFFLINE_QUEUE_KEY, remaining)
  } else {
    await del(OFFLINE_QUEUE_KEY)
  }

  return { synced, failed }
}


// ===================== Map Tile Cache Orchestrator =====================

const TILE_CACHE_NAME = 'jeevansetu-map-tiles-v1'

// Major Indian regions to pre-cache tile grids for (zoom 10-13)
const PRECACHE_REGIONS = [
  // Bengaluru center (~30km radius)
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, zoom: [10, 11, 12, 13] },
  // Mangaluru (Coastal Karnataka)
  { name: 'Mangaluru', lat: 12.9141, lng: 74.8560, zoom: [10, 11, 12] },
]

/**
 * Convert lat/lng to tile x/y at given zoom.
 */
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return { x, y }
}

/**
 * Pre-cache a grid of OSM tiles around a location.
 * Caches a 5x5 tile grid centered on the location at each zoom level.
 */
export async function precacheRegionTiles(
  lat: number,
  lng: number,
  zoomLevels: number[] = [10, 11, 12, 13]
): Promise<{ cached: number; errors: number }> {
  let cached = 0
  let errors = 0

  try {
    const cache = await caches.open(TILE_CACHE_NAME)
    const radius = 2 // 5x5 grid around center tile

    for (const zoom of zoomLevels) {
      const center = latLngToTile(lat, lng, zoom)

      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const tx = center.x + dx
          const ty = center.y + dy

          // Standard OSM tile URL (sub-domain rotation)
          const sub = ['a', 'b', 'c'][Math.abs(tx + ty) % 3]
          const tileUrl = `https://${sub}.tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`

          // Skip if already cached
          const existing = await cache.match(tileUrl)
          if (existing) {
            cached++
            continue
          }

          try {
            const resp = await fetch(tileUrl)
            if (resp.ok) {
              await cache.put(tileUrl, resp)
              cached++
            } else {
              errors++
            }
          } catch {
            errors++
          }
        }
      }
    }
  } catch (e) {
    console.warn('Tile pre-cache failed:', e)
  }

  return { cached, errors }
}

/**
 * Pre-cache default Indian disaster-prone regions.
 */
export async function precacheDefaultRegions(): Promise<{ total: number }> {
  let total = 0

  for (const region of PRECACHE_REGIONS) {
    const result = await precacheRegionTiles(region.lat, region.lng, region.zoom)
    total += result.cached
  }

  return { total }
}

/**
 * Get estimated tile cache size info.
 */
export async function getTileCacheInfo(): Promise<{
  estimatedTiles: number
  available: boolean
}> {
  try {
    const cache = await caches.open(TILE_CACHE_NAME)
    const keys = await cache.keys()
    return { estimatedTiles: keys.length, available: true }
  } catch {
    return { estimatedTiles: 0, available: false }
  }
}

