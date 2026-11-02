// Node test runner for Phase 1 Disaster Prediction Engine
// Tests rule-based risk calculations for Flood, Cyclone, Landslide, and Heatwave

function computeRisk(telemetry, region) {
  // Flood Score
  let floodScore = 0;
  if (telemetry.precipitation_mm > 0) {
    floodScore += Math.min(60, (telemetry.precipitation_mm / 80) * 60);
  }
  if (telemetry.discharge_ratio > 1.3) {
    floodScore += Math.min(30, (telemetry.discharge_ratio - 1.0) * 20);
  }
  if (telemetry.current_precip_mm > 5) {
    floodScore += Math.min(15, telemetry.current_precip_mm * 2);
  }
  floodScore = Math.min(100, Math.round(floodScore));

  // Cyclone Score
  let cycloneScore = 0;
  if (telemetry.wind_speed_kmh > 35) {
    cycloneScore += Math.min(50, ((telemetry.wind_speed_kmh - 35) / 50) * 50);
  }
  if (telemetry.wind_gusts_kmh > 50) {
    cycloneScore += Math.min(35, ((telemetry.wind_gusts_kmh - 50) / 60) * 35);
  }
  if (telemetry.precipitation_mm > 40) {
    cycloneScore += 15;
  }
  cycloneScore = Math.min(100, Math.round(cycloneScore));

  // Landslide Score
  let landslideScore = 0;
  if (region.slope_factor > 0.3) {
    const rainFactor = Math.min(70, (telemetry.precipitation_mm / 70) * 70);
    landslideScore += rainFactor * region.slope_factor;
    if (telemetry.recent_quakes > 0) {
      landslideScore += 25;
    }
  }
  landslideScore = Math.min(100, Math.round(landslideScore));

  // Heatwave Score
  let heatwaveScore = 0;
  if (telemetry.max_temp_c >= 38) {
    heatwaveScore = Math.min(100, Math.round(((telemetry.max_temp_c - 37) / 8) * 100));
  }

  const hazards = [
    { name: "flood", score: floodScore },
    { name: "cyclone", score: cycloneScore },
    { name: "landslide", score: landslideScore },
    { name: "heatwave", score: heatwaveScore },
  ];
  hazards.sort((a, b) => b.score - a.score);

  const primary = hazards[0];
  let level = "low";
  if (primary.score >= 80) level = "critical";
  else if (primary.score >= 60) level = "high";
  else if (primary.score >= 35) level = "moderate";

  return { primary, level };
}

const testCases = [
  {
    region: { name: "Dakshina Kannada (Mangaluru)", slope_factor: 0.35 },
    telemetry: { precipitation_mm: 75, discharge_ratio: 2.2, current_precip_mm: 8, wind_speed_kmh: 30, wind_gusts_kmh: 40, max_temp_c: 28, recent_quakes: 0 },
    expectedHazard: "flood",
    minLevel: "high"
  },
  {
    region: { name: "Puri / Coastal Odisha", slope_factor: 0.1 },
    telemetry: { precipitation_mm: 55, discharge_ratio: 1.2, current_precip_mm: 4, wind_speed_kmh: 88, wind_gusts_kmh: 110, max_temp_c: 27, recent_quakes: 0 },
    expectedHazard: "cyclone",
    minLevel: "critical"
  },
  {
    region: { name: "Uttara Kannada (Karwar)", slope_factor: 0.8 },
    telemetry: { precipitation_mm: 85, discharge_ratio: 1.2, current_precip_mm: 2, wind_speed_kmh: 25, wind_gusts_kmh: 35, max_temp_c: 26, recent_quakes: 1 },
    expectedHazard: "landslide",
    minLevel: "high"
  },
  {
    region: { name: "Delhi NCR", slope_factor: 0.05 },
    telemetry: { precipitation_mm: 0, discharge_ratio: 0.5, current_precip_mm: 0, wind_speed_kmh: 18, wind_gusts_kmh: 24, max_temp_c: 44.2, recent_quakes: 0 },
    expectedHazard: "heatwave",
    minLevel: "high"
  }
];

console.log("=================================================================");
console.log("JeevanSetu AI - Phase 1 Prediction Engine Unit Test");
console.log("=================================================================\n");

let passed = 0;
for (const tc of testCases) {
  const result = computeRisk(tc.telemetry, tc.region);
  const ok = result.primary.name === tc.expectedHazard;
  console.log(`[Region: ${tc.region.name}]`);
  console.log(`  Telemetry: Rain=${tc.telemetry.precipitation_mm}mm, Wind=${tc.telemetry.wind_speed_kmh}km/h, Temp=${tc.telemetry.max_temp_c}°C, DischargeRatio=${tc.telemetry.discharge_ratio}`);
  console.log(`  Calculated: Hazard=${result.primary.name.toUpperCase()} (Score: ${result.primary.score}/100, Level: ${result.level.toUpperCase()})`);
  console.log(`  Expected Hazard: ${tc.expectedHazard.toUpperCase()} -> ${ok ? "PASS ✅" : "FAIL ❌"}\n`);
  if (ok) passed++;
}

console.log(`Results: ${passed}/${testCases.length} test cases passed.`);
if (passed === testCases.length) {
  console.log("ALL PREDICTION TESTS PASSED SUCCESSFULLY! 🚀");
} else {
  process.exit(1);
}

