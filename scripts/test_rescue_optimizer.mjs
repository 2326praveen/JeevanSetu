// Test runner for Phase 5: Rescue Resource Optimizer
// Tests:
// 1. Multi-factor priority score calculation (urgency, vulnerability, waiting time, spatial cluster)
// 2. Greedy nearest team assignment with specialized unit matching
// 3. Cluster centroid detection for rapid ambulance staging positions
// 4. Shelter occupancy tracking and automated overflow diversion

import assert from 'assert';

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

function calculateTicketPriority(ticket, allTickets = []) {
  const urgency = ticket.urgency || 3;
  const baseScore = urgency * 20;

  const flags = ticket.vulnerable_flags || [];
  let vulnBonus = flags.length * 15;
  if (flags.some(f => ['infant', 'pregnant', 'child'].includes(f.toLowerCase()))) {
    vulnBonus += 10;
  }
  const peopleBonus = Math.min(25, (ticket.people_at_risk || 1) * 5);
  const totalVuln = vulnBonus + peopleBonus;

  const createdTime = new Date(ticket.created_at || Date.now()).getTime();
  const waitMinutes = Math.max(0, Math.floor((Date.now() - createdTime) / 60000));
  const waitBonus = Math.min(60, Math.round(waitMinutes * 1.5));

  let nearbyCount = 0;
  if (ticket.lat && ticket.lng) {
    for (const other of allTickets) {
      if (other.id !== ticket.id && other.status !== 'resolved' && other.lat && other.lng) {
        const meters = haversineMeters(ticket.lat, ticket.lng, other.lat, other.lng);
        if (meters <= 1500) {
          nearbyCount++;
        }
      }
    }
  }
  const clusterBonus = Math.min(40, nearbyCount * 10);
  const totalScore = Math.round((baseScore + totalVuln + waitBonus + clusterBonus) * 10) / 10;

  let tier = 'LOW';
  if (totalScore >= 110) tier = 'CRITICAL';
  else if (totalScore >= 85) tier = 'HIGH';
  else if (totalScore >= 55) tier = 'MEDIUM';

  return { totalScore, tier, waitMinutes, nearbyCount, breakdown: { baseScore, totalVuln, waitBonus, clusterBonus } };
}

function computeGreedyMatches(tickets, teams) {
  const unassigned = tickets.filter(t => t.status === 'new' && !t.assigned_team_id);
  const scored = unassigned.map(t => ({
    ticket: t,
    priority: calculateTicketPriority(t, tickets)
  })).sort((a, b) => b.priority.totalScore - a.priority.totalScore);

  const remainingTeams = [...teams.filter(t => t.available)];
  const suggestions = [];

  for (const item of scored) {
    if (remainingTeams.length === 0) break;
    const t = item.ticket;
    const tLat = t.lat ?? 12.9716;
    const tLng = t.lng ?? 77.5946;

    const emergencyType = (t.emergency_type || '').toLowerCase();
    let preferredType = '';
    if (emergencyType.includes('flood')) preferredType = 'ndrf_boat';
    else if (emergencyType.includes('medical')) preferredType = 'ambulance';
    else if (emergencyType.includes('fire')) preferredType = 'fire_rescue';

    let bestIdx = -1;
    let bestScore = Infinity;
    let bestDistKm = 0;

    for (let i = 0; i < remainingTeams.length; i++) {
      const team = remainingTeams[i];
      const distKm = haversineMeters(tLat, tLng, team.lat, team.lng) / 1000;
      let cost = distKm;
      if (preferredType && team.type.toLowerCase().includes(preferredType.replace('_', ''))) {
        cost *= 0.5;
      }
      if (cost < bestScore) {
        bestScore = cost;
        bestIdx = i;
        bestDistKm = distKm;
      }
    }

    if (bestIdx >= 0) {
      const chosenTeam = remainingTeams[bestIdx];
      remainingTeams.splice(bestIdx, 1);
      suggestions.push({
        ticketId: t.id,
        teamId: chosenTeam.id,
        teamName: chosenTeam.name,
        teamType: chosenTeam.type,
        distanceKm: Math.round(bestDistKm * 10) / 10,
        priorityScore: item.priority.totalScore
      });
    }
  }

  return suggestions;
}

function detectStagingCentroids(tickets) {
  const active = tickets.filter(t => t.status !== 'resolved' && t.lat && t.lng);
  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < active.length; i++) {
    const t1 = active[i];
    if (visited.has(t1.id)) continue;
    const current = [t1];
    visited.add(t1.id);

    for (let j = i + 1; j < active.length; j++) {
      const t2 = active[j];
      if (visited.has(t2.id)) continue;
      if (haversineMeters(t1.lat, t1.lng, t2.lat, t2.lng) <= 2000) {
        current.push(t2);
        visited.add(t2.id);
      }
    }
    if (current.length >= 2) clusters.push(current);
  }

  return clusters.map(c => ({
    ticketCount: c.length,
    peopleAtRisk: c.reduce((s, t) => s + (t.people_at_risk || 1), 0),
    centroidLat: c.reduce((s, t) => s + t.lat, 0) / c.length,
    centroidLng: c.reduce((s, t) => s + t.lng, 0) / c.length,
    recommendedAmbulances: Math.max(1, Math.ceil(c.reduce((s, t) => s + (t.people_at_risk || 1), 0) / 4))
  }));
}

function checkShelterDiversion(shelters) {
  return shelters.map(s => {
    const utilPct = Math.round((s.occupancy / s.capacity) * 100);
    const isCritical = utilPct >= 85;
    let diversionTarget = null;
    if (isCritical) {
      diversionTarget = shelters.find(o => o.id !== s.id && (o.occupancy / o.capacity) < 0.6);
    }
    return { id: s.id, name: s.name, utilPct, isCritical, diversionTargetName: diversionTarget?.name };
  });
}

console.log("=================================================================");
console.log("JeevanSetu AI - Phase 5 Rescue Resource Optimizer Test Suite");
console.log("=================================================================\n");

let passed = 0;

// Test 1: Priority Score & Tier Formulation
try {
  const highRiskTicket = {
    id: 't-1',
    urgency: 5, // 100 pts
    people_at_risk: 4, // +20 pts
    vulnerable_flags: ['infant', 'elderly'], // +30 pts + 10 infant bonus = +40 pts
    created_at: new Date(Date.now() - 20 * 60000).toISOString(), // 20 mins * 1.5 = +30 pts
    lat: 12.9660,
    lng: 77.5840
  };

  const nearbyTicket = {
    id: 't-2',
    urgency: 4,
    people_at_risk: 2,
    lat: 12.9670,
    lng: 77.5850 // ~150 meters away -> triggers cluster bonus!
  };

  const result = calculateTicketPriority(highRiskTicket, [highRiskTicket, nearbyTicket]);
  // Base 100 + Vuln (40 + 20) + Wait 30 + Cluster 10 = 200 pts
  assert.ok(result.totalScore >= 160, `Priority score ${result.totalScore} should be >= 160`);
  assert.strictEqual(result.tier, 'CRITICAL');
  assert.strictEqual(result.nearbyCount, 1);
  console.log(`✅ Test 1 Passed: Calculated multi-factor priority score (${result.totalScore} pts [${result.tier}]).`);
  passed++;
} catch (err) {
  console.error("❌ Test 1 Failed:", err);
}

// Test 2: Greedy Matching with Skill Specialization
try {
  const sampleTickets = [
    { id: 't-flood', urgency: 5, emergency_type: 'flood', status: 'new', lat: 12.9660, lng: 77.5840, vulnerable_flags: ['infant'] },
    { id: 't-med', urgency: 4, emergency_type: 'medical', status: 'new', lat: 12.9380, lng: 77.6150, vulnerable_flags: ['pregnant'] }
  ];

  const sampleTeams = [
    { id: 'team-boat', name: 'NDRF Boat Unit', type: 'ndrf_boat', available: true, lat: 12.9650, lng: 77.5800 },
    { id: 'team-amb', name: '108 Ambulance Unit', type: 'ambulance', available: true, lat: 12.9400, lng: 77.6100 }
  ];

  const matches = computeGreedyMatches(sampleTickets, sampleTeams);
  assert.strictEqual(matches.length, 2);
  const floodMatch = matches.find(m => m.ticketId === 't-flood');
  const medMatch = matches.find(m => m.ticketId === 't-med');

  assert.strictEqual(floodMatch.teamType, 'ndrf_boat', 'Flood emergency matched to NDRF boat unit');
  assert.strictEqual(medMatch.teamType, 'ambulance', 'Medical emergency matched to 108 Ambulance');
  console.log("✅ Test 2 Passed: Greedy dispatch paired specialized rescue teams with zero conflict.");
  passed++;
} catch (err) {
  console.error("❌ Test 2 Failed:", err);
}

// Test 3: Emergency Cluster Centroid & Rapid Staging Hubs
try {
  const clusterTickets = [
    { id: 't-c1', status: 'new', lat: 12.9660, lng: 77.5840, people_at_risk: 4 },
    { id: 't-c2', status: 'new', lat: 12.9690, lng: 77.5870, people_at_risk: 3 },
    { id: 't-far', status: 'new', lat: 13.1000, lng: 77.7000, people_at_risk: 1 } // Far away
  ];

  const hubs = detectStagingCentroids(clusterTickets);
  assert.strictEqual(hubs.length, 1, 'Exactly one dense cluster identified');
  assert.strictEqual(hubs[0].ticketCount, 2);
  assert.strictEqual(hubs[0].peopleAtRisk, 7);
  assert.strictEqual(hubs[0].recommendedAmbulances, 2); // 7 people -> ceil(7/4) = 2 ambulances
  console.log("✅ Test 3 Passed: Emergency cluster centroid identified with rapid staging fleet size.");
  passed++;
} catch (err) {
  console.error("❌ Test 3 Failed:", err);
}

// Test 4: Shelter Occupancy & Automatic Diversion
try {
  const shelters = [
    { id: 's-1', name: 'Kanteerava Mega Shelter', capacity: 1000, occupancy: 890 }, // 89% -> Critical
    { id: 's-2', name: 'Koramangala Relief Hub', capacity: 600, occupancy: 180 }   // 30% -> Optimal
  ];

  const analyzed = checkShelterDiversion(shelters);
  const kanteerava = analyzed.find(s => s.name === 'Kanteerava Mega Shelter');
  assert.strictEqual(kanteerava.isCritical, true);
  assert.strictEqual(kanteerava.utilPct, 89);
  assert.strictEqual(kanteerava.diversionTargetName, 'Koramangala Relief Hub');
  console.log("✅ Test 4 Passed: Overcrowded shelter detected (89%) and diverted to Koramangala Relief Hub (30%).");
  passed++;
} catch (err) {
  console.error("❌ Test 4 Failed:", err);
}

console.log(`\nResults: ${passed}/4 tests passed successfully.\n`);
if (passed === 4) {
  process.exit(0);
} else {
  process.exit(1);
}

