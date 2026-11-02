import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

interface MonitoredRegion {
  region: string;
  lat: number;
  lng: number;
  slope_factor: number; // 0 (flat plains) to 1.0 (steep Western Ghats / Himalayas)
}

const MONITORED_REGIONS: MonitoredRegion[] = [
  { region: "Dakshina Kannada (Mangaluru)", lat: 12.9141, lng: 74.8560, slope_factor: 0.35 },
  { region: "Bengaluru Urban", lat: 12.9716, lng: 77.5946, slope_factor: 0.1 },
  { region: "Uttara Kannada (Karwar)", lat: 14.8185, lng: 74.1350, slope_factor: 0.8 },
  { region: "Kodagu (Madikeri)", lat: 12.4244, lng: 75.7382, slope_factor: 0.9 },
  { region: "Puri / Coastal Odisha", lat: 19.8135, lng: 85.8312, slope_factor: 0.1 },
  { region: "Delhi NCR", lat: 28.6139, lng: 77.2090, slope_factor: 0.05 },
];

interface HazardTelemetry {
  precipitation_mm: number;
  current_precip_mm: number;
  wind_speed_kmh: number;
  wind_gusts_kmh: number;
  max_temp_c: number;
  river_discharge_m3s: number;
  discharge_ratio: number;
  recent_quakes: number;
  max_quake_magnitude: number;
}

interface RiskAssessment {
  region: string;
  lat: number;
  lng: number;
  hazard: string;
  score: number;
  level: "low" | "moderate" | "high" | "critical";
  advisory: string;
  checklist: string[];
  metrics: Record<string, any>;
  valid_until: string;
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const targetRegion = url.searchParams.get("region");

  try {
    const groqApiKey = Deno.env.get("GROQ_API_KEY") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const regionsToProcess = targetRegion
      ? MONITORED_REGIONS.filter((r) => r.region.toLowerCase().includes(targetRegion.toLowerCase()))
      : MONITORED_REGIONS;

    const assessments: RiskAssessment[] = [];

    for (const region of regionsToProcess) {
      const assessment = await evaluateDistrictRisk(region, groqApiKey);
      assessments.push(assessment);
    }

    // Persist to Supabase if configured and not dry-run
    if (!dryRun && supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      for (const item of assessments) {
        const { error: upsertErr } = await supabase
          .from("risk_forecasts")
          .upsert(
            {
              region: item.region,
              lat: item.lat,
              lng: item.lng,
              hazard: item.hazard,
              score: item.score,
              level: item.level,
              advisory: item.advisory,
              metrics: item.metrics,
              checklist: item.checklist,
              valid_until: item.valid_until,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "region" }
          );

        if (upsertErr) {
          console.error(`Failed to upsert risk forecast for ${item.region}:`, upsertErr);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: assessments.length,
        forecasts: assessments,
        persisted: !dryRun && Boolean(supabaseUrl && supabaseServiceKey),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Disaster prediction engine error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Risk prediction failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function evaluateDistrictRisk(
  region: MonitoredRegion,
  groqApiKey: string
): Promise<RiskAssessment> {
  // 1. Fetch telemetry with graceful timeouts (Open-Meteo & USGS free feeds)
  const telemetry = await fetchTelemetry(region.lat, region.lng);

  // 2. Compute Rule-based scores
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

  // Earthquake Score
  let earthquakeScore = 0;
  if (telemetry.max_quake_magnitude >= 3.0) {
    earthquakeScore = Math.min(100, Math.round(((telemetry.max_quake_magnitude - 2.5) / 4) * 100));
  }

  // Determine Primary Hazard
  const hazards = [
    { name: "flood", score: floodScore },
    { name: "cyclone", score: cycloneScore },
    { name: "landslide", score: landslideScore },
    { name: "heatwave", score: heatwaveScore },
    { name: "earthquake", score: earthquakeScore },
  ];

  hazards.sort((a, b) => b.score - a.score);
  const primary = hazards[0].score > 20 ? hazards[0] : { name: "flood", score: Math.max(15, hazards[0].score) };

  // Determine Level
  let level: "low" | "moderate" | "high" | "critical" = "low";
  if (primary.score >= 80) level = "critical";
  else if (primary.score >= 60) level = "high";
  else if (primary.score >= 35) level = "moderate";

  // 3. Generate plain language advisory and actionable checklist via Groq
  const { advisory, checklist } = await generateAdvisory(
    region.region,
    primary.name,
    primary.score,
    level,
    telemetry,
    groqApiKey
  );

  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return {
    region: region.region,
    lat: region.lat,
    lng: region.lng,
    hazard: primary.name,
    score: primary.score,
    level,
    advisory,
    checklist,
    metrics: {
      precipitation_mm: telemetry.precipitation_mm,
      river_discharge_m3s: telemetry.river_discharge_m3s,
      wind_speed_kmh: telemetry.wind_speed_kmh,
      max_temp_c: telemetry.max_temp_c,
      recent_quakes: telemetry.recent_quakes,
    },
    valid_until: validUntil,
  };
}

async function fetchTelemetry(lat: number, lng: number): Promise<HazardTelemetry> {
  const result: HazardTelemetry = {
    precipitation_mm: 0,
    current_precip_mm: 0,
    wind_speed_kmh: 15,
    wind_gusts_kmh: 20,
    max_temp_c: 30,
    river_discharge_m3s: 20,
    discharge_ratio: 1.0,
    recent_quakes: 0,
    max_quake_magnitude: 0,
  };

  const fetchWithTimeout = async (url: string, timeoutMs = 3500): Promise<any | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      clearTimeout(timeout);
      return null;
    }
  };

  // 1. Open-Meteo Weather
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m&daily=precipitation_sum,wind_speed_10m_max,temperature_2m_max&timezone=auto`;
    const wData = await fetchWithTimeout(weatherUrl);
    if (wData) {
      result.current_precip_mm = Number(wData.current?.precipitation || 0);
      result.wind_speed_kmh = Number(wData.current?.wind_speed_10m || 15);
      result.wind_gusts_kmh = Number(wData.current?.wind_gusts_10m || result.wind_speed_kmh * 1.3);
      result.precipitation_mm = Number(wData.daily?.precipitation_sum?.[0] || result.current_precip_mm * 4);
      result.max_temp_c = Number(wData.daily?.temperature_2m_max?.[0] || wData.current?.temperature_2m || 30);
    }
  } catch (err) {
    console.warn("Open-Meteo weather fetch fallback:", err);
  }

  // 2. Open-Meteo Flood API
  try {
    const floodUrl = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge,river_discharge_mean,river_discharge_max&forecast_days=3`;
    const fData = await fetchWithTimeout(floodUrl);
    if (fData && fData.daily) {
      const mean = Number(fData.daily.river_discharge_mean?.[0] || 20);
      const max = Number(fData.daily.river_discharge_max?.[0] || mean);
      result.river_discharge_m3s = max;
      result.discharge_ratio = mean > 0 ? max / mean : 1.0;
    }
  } catch (err) {
    console.warn("Open-Meteo flood fetch fallback:", err);
  }

  // 3. USGS Earthquake feed
  try {
    const quakeUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lng}&maxradiuskm=300&minmagnitude=3.0`;
    const qData = await fetchWithTimeout(quakeUrl);
    if (qData && Array.isArray(qData.features)) {
      result.recent_quakes = qData.features.length;
      let maxMag = 0;
      for (const feat of qData.features) {
        const mag = Number(feat.properties?.mag || 0);
        if (mag > maxMag) maxMag = mag;
      }
      result.max_quake_magnitude = maxMag;
    }
  } catch (err) {
    console.warn("USGS quake fetch fallback:", err);
  }

  return result;
}

async function generateAdvisory(
  regionName: string,
  hazard: string,
  score: number,
  level: "low" | "moderate" | "high" | "critical",
  metrics: HazardTelemetry,
  groqApiKey: string
): Promise<{ advisory: string; checklist: string[] }> {
  if (groqApiKey) {
    try {
      const prompt = `You are JeevanSetu AI's Emergency Disaster Specialist in India.
Region: ${regionName}
Hazard: ${hazard.toUpperCase()}
Risk Score: ${score}/100 (${level.toUpperCase()})
Telemetry: Daily Precipitation: ${metrics.precipitation_mm}mm, River Discharge: ${metrics.river_discharge_m3s} m³/s, Wind: ${metrics.wind_speed_kmh} km/h, Max Temp: ${metrics.max_temp_c}°C, Recent Seismic Events: ${metrics.recent_quakes}.

Generate a concise, location-specific citizen advisory (2 sentences) and exactly 4 actionable preparedness checklist items for families living in this district.

Respond strictly with RAW JSON only. Do not add markdown backticks.
Schema:
{
  "advisory": "2 sentence clear actionable alert for local citizens",
  "checklist": [
    "action item 1",
    "action item 2",
    "action item 3",
    "action item 4"
  ]
}`;

      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed.advisory && Array.isArray(parsed.checklist) && parsed.checklist.length > 0) {
            return {
              advisory: parsed.advisory,
              checklist: parsed.checklist.slice(0, 4),
            };
          }
        }
      }
    } catch (err) {
      console.warn("Groq advisory generation fallback:", err);
    }
  }

  // High-reliability Fallback Templates
  return getFallbackAdvisory(regionName, hazard, level, metrics);
}

function getFallbackAdvisory(
  regionName: string,
  hazard: string,
  level: "low" | "moderate" | "high" | "critical",
  metrics: HazardTelemetry
): { advisory: string; checklist: string[] } {
  if (hazard === "flood") {
    if (level === "critical" || level === "high") {
      return {
        advisory: `High flood inundation risk in ${regionName} due to ${metrics.precipitation_mm}mm rainfall and river discharge reaching ${metrics.river_discharge_m3s} m³/s. Low-lying riparian settlements should prepare for water ingress and monitor civil authority warnings.`,
        checklist: [
          "Store 3 days of potable water and non-perishable rations",
          "Elevate electrical appliances and switch off ground-level circuit breakers",
          "Pack identity records and medicines in waterproof pouches",
          "Locate your nearest designated relief shelter and keep emergency contacts ready",
        ],
      };
    }
    return {
      advisory: `Moderate localized waterlogging anticipated across ${regionName} during peak downpours. Urban underpasses and natural drainage channels may experience temporary overflow.`,
      checklist: [
        "Avoid commuting through waterlogged underpasses and storm drains",
        "Clear leaves and silt from property perimeter drains",
        "Keep mobile phones and emergency flashlights fully charged",
        "Monitor local weather radar updates before travelling",
      ],
    };
  }

  if (hazard === "cyclone") {
    return {
      advisory: `Severe squall and cyclonic wind gusts up to ${metrics.wind_gusts_kmh || 75} km/h forecast near ${regionName}. Coastal and exposed structures face potential wind damage and tidal surging.`,
      checklist: [
        "Anchor or store loose outdoor tin sheets, signboards, and outdoor furniture",
        "Fasten window shutters and apply adhesive tape across large glass panes",
        "Keep battery-powered transistor radios and torches handy",
        "Heed municipal evacuation warnings to move to cyclone shelters immediately",
      ],
    };
  }

  if (hazard === "landslide") {
    return {
      advisory: `Western Ghats soil saturation threshold exceeded near ${regionName} following heavy rainfall. High susceptibility to debris slides along hill cuts and ghat roadways.`,
      checklist: [
        "Avoid non-essential transit across steep mountain ghat corridors",
        "Inspect property surroundings for ground fissures or tilting trees",
        "Evacuate immediately if sudden muddy water or rumbling vibrations occur",
        "Stay alert to district disaster management control room broadcasts",
      ],
    };
  }

  if (hazard === "heatwave") {
    return {
      advisory: `Extreme temperature spike of ${metrics.max_temp_c}°C recorded in ${regionName}. High risk of sunstroke, heat exhaustion, and dehydration during midday hours.`,
      checklist: [
        "Avoid direct outdoor sun exposure between 12:00 PM and 4:00 PM",
        "Consume plenty of water, lemon water, and ORS at regular intervals",
        "Keep infants, elderly, and pets in cool, shaded spaces with good ventilation",
        "Wear loose, light-colored cotton clothing and cover head when outdoors",
      ],
    };
  }

  return {
    advisory: `Conditions in ${regionName} are currently stable with low hazard threat indicators. Community monitoring and routine preparedness recommended.`,
    checklist: [
      "Review household emergency evacuation plans",
      "Keep first-aid kits and emergency contacts up to date",
      "Ensure household drainage lines remain unobstructed",
      "Save emergency helpline 112 and JeevanSetu AI app on mobile devices",
    ],
  };
}

