import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getAIAdapter } from "../_shared/aiAdapter.ts";
import { checkRateLimit } from "../_shared/rateLimiter.ts";

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { allowed } = checkRateLimit(req, 25);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const text = body.text || body.message || "";

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Input text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adapter = getAIAdapter();
    const triageResult = await adapter.triageEmergencyText(text);

    return new Response(JSON.stringify({ success: true, triage: triageResult }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Triage endpoint error:", error);
    return new Response(JSON.stringify({ error: error.message || "Triage failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
