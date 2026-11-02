import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getAIAdapter } from "../_shared/aiAdapter.ts";
import { geocodeLocationText } from "../_shared/nominatim.ts";
import { checkRateLimit } from "../_shared/rateLimiter.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Rate Limit check (15 tickets/min per IP)
  const { allowed } = checkRateLimit(req, 15);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Too many SOS requests. Please wait a moment." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const rawText = (body.text || body.original_text || "").trim();
    const channel = body.channel || "app";
    const reporterPhone = body.phone || body.reporter_phone || null;
    let lat: number | null = body.lat !== undefined && body.lat !== null ? parseFloat(body.lat) : null;
    let lng: number | null = body.lng !== undefined && body.lng !== null ? parseFloat(body.lng) : null;
    let addressText: string = body.address_text || "";
    const reporterId = body.reporter_id || null;

    if (!rawText) {
      return new Response(JSON.stringify({ error: "SOS message text is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. AI Triage Pipeline (Whisper/Llama 3.3 70B Adapter)
    const adapter = getAIAdapter();
    const triage = await adapter.triageEmergencyText(rawText);

    // 3. Geocoding Fallback Resolution:
    // If browser GPS is not provided, query Nominatim OSM geocoder using extracted location_text
    if ((lat === null || lng === null || isNaN(lat) || isNaN(lng)) && triage.location_text) {
      const geoResult = await geocodeLocationText(triage.location_text);
      if (geoResult) {
        lat = geoResult.lat;
        lng = geoResult.lng;
        addressText = geoResult.displayName;
      }
    }

    // Default fallback coordinates if completely unknown (Central Bengaluru coordinates)
    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
      lat = 12.9716;
      lng = 77.5946;
      if (!addressText) {
        addressText = triage.location_text || "Bengaluru Emergency Zone (Approximate)";
      }
    }

    // 4. Initialize Supabase Admin Client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 5. Insert Ticket
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .insert({
        channel,
        original_text: rawText,
        original_language: triage.detected_language || "en",
        translated_text_en: triage.english_summary,
        emergency_type: triage.emergency_type,
        urgency: triage.urgency,
        people_at_risk: triage.people_at_risk,
        vulnerable_flags: triage.vulnerable_flags,
        lat,
        lng,
        address_text: addressText || triage.location_text || "Location pinned",
        status: "new",
        reporter_id: reporterId,
        reporter_phone: reporterPhone,
        ai_summary: triage.english_summary,
        reply_in_user_language: triage.reply_in_user_language,
      })
      .select()
      .single();

    if (ticketError || !ticket) {
      console.error("Database ticket insert error:", ticketError);
      throw new Error(`Failed to create ticket: ${ticketError?.message}`);
    }

    // 6. Log Ticket Event
    await supabase.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor: "system_ai_intake",
      event: "ticket_created",
      metadata: {
        channel,
        urgency: triage.urgency,
        emergency_type: triage.emergency_type,
        vulnerable_flags: triage.vulnerable_flags,
      },
    });

    // 7. Fetch Nearest Facilities via Haversine RPC
    const { data: nearbyFacilities } = await supabase.rpc("nearest_facilities", {
      user_lat: lat,
      user_lng: lng,
      facility_type: null,
      max_results: 3,
    });

    return new Response(
      JSON.stringify({
        success: true,
        ticket,
        triage,
        nearby_facilities: nearbyFacilities || [],
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Create ticket error:", err);
    return new Response(JSON.stringify({ error: err.message || "Failed to process emergency intake" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
