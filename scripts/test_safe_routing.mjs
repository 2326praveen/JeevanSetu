// Node test runner for Phase 3 Safe Routing & Hazard Avoidance Engine
// Tests:
// 1. Distance calculations in meters
// 2. Polyline hazard proximity detection
// 3. Detour waypoint generation around blocked roads

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function minDistanceToRoute(hazardLat, hazardLng, coords) {
  let minD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineMeters(hazardLat, hazardLng, coords[i][0], coords[i][1]);
    if (d < minD) minD = d;
    if (i < coords.length - 1) {
      const midLat = (coords[i][0] + coords[i + 1][0]) / 2;
      const midLng = (coords[i][1] + coords[i + 1][1]) / 2;
      const dMid = haversineMeters(hazardLat, hazardLng, midLat, midLng);
      if (dMid < minD) minD = dMid;
    }
  }
  return minD;
}

function computeDetour(hazard, start, end) {
  const dx = end[1] - start[1];
  const dy = end[0] - start[0];
  const len = Math.sqrt(dx * dx + dy * dy) || 0.001;
  const nx = -dy / len;
  const ny = dx / len;
  const offsetMeters = hazard.avoid_radius_meters + 150;
  return {
    lat: hazard.lat + (ny * offsetMeters) / 111000,
    lng: hazard.lng + (nx * offsetMeters) / 100000
  };
}

console.log("=================================================================");
console.log("JeevanSetu AI - Phase 3 Safe Routing & Hazard Avoidance Test Suite");
console.log("=================================================================\n");

// Test 1: Direct route intersecting flooded underpass
const startPoint = [12.9600, 77.5800]; // South-West of K.R. Market
const destination = [12.9800, 77.5900]; // North-East (Bowring Hospital direction)

// A straight-line or multi-step route passing directly through [12.9680, 77.5850]
const directRouteCoords = [
  [12.9600, 77.5800],
  [12.9640, 77.5825],
  [12.9680, 77.5850], // Direct match with hazard!
  [12.9720, 77.5875],
  [12.9800, 77.5900]
];

const floodedHazard = {
  id: "h-flood",
  hazard_type: "flooded_road",
  lat: 12.9682,
  lng: 77.5851,
  avoid_radius_meters: 300,
  description: "Flooded Railway Underpass"
};

const distantHazard = {
  id: "h-distant",
  hazard_type: "fallen_tree",
  lat: 12.9420,
  lng: 77.6180,
  avoid_radius_meters: 150,
  description: "Distant tree in Koramangala"
};

const dFlood = minDistanceToRoute(floodedHazard.lat, floodedHazard.lng, directRouteCoords);
const dDistant = minDistanceToRoute(distantHazard.lat, distantHazard.lng, directRouteCoords);

console.log(`[Test 1] Hazard Proximity Detection:`);
console.log(`  Flooded Underpass Distance to Route: ${Math.round(dFlood)}m (Avoid Radius: ${floodedHazard.avoid_radius_meters}m)`);
console.log(`  Should trigger warning: ${dFlood <= floodedHazard.avoid_radius_meters ? "YES -> PASS ✅" : "NO -> FAIL ❌"}`);

console.log(`\n[Test 2] Distant Hazard Independence:`);
console.log(`  Koramangala Tree Distance to Route: ${Math.round(dDistant)}m (Avoid Radius: ${distantHazard.avoid_radius_meters}m)`);
console.log(`  Should NOT trigger warning: ${dDistant > distantHazard.avoid_radius_meters ? "YES -> PASS ✅" : "NO -> FAIL ❌"}`);

// Test 3: Detour calculation
const detour = computeDetour(floodedHazard, startPoint, destination);
const detourDistanceToHazard = haversineMeters(floodedHazard.lat, floodedHazard.lng, detour.lat, detour.lng);

console.log(`\n[Test 3] Detour Clearance Calculation:`);
console.log(`  Detour Waypoint: Lat ${detour.lat.toFixed(5)}, Lng ${detour.lng.toFixed(5)}`);
console.log(`  Clearance from Hazard Center: ${Math.round(detourDistanceToHazard)}m`);
console.log(`  Safely clears avoid radius (> ${floodedHazard.avoid_radius_meters}m): ${detourDistanceToHazard > floodedHazard.avoid_radius_meters ? "PASS ✅" : "FAIL ❌"}`);

const allPassed = (dFlood <= floodedHazard.avoid_radius_meters) && 
                  (dDistant > distantHazard.avoid_radius_meters) && 
                  (detourDistanceToHazard > floodedHazard.avoid_radius_meters);

console.log(`\n=================================================================`);
if (allPassed) {
  console.log("ALL SAFE ROUTING TESTS PASSED! 🚀");
} else {
  console.log("ROUTING TESTS FAILED ❌");
  process.exit(1);
}

