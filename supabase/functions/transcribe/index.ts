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

  const { allowed } = checkRateLimit(req, 20);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a minute." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let audioBlob: Blob;
    let languageHint: string | undefined = undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof Blob)) {
        return new Response(JSON.stringify({ error: "Audio file is required in 'file' form-data field" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      audioBlob = file;
      const hint = formData.get("language");
      if (typeof hint === "string") languageHint = hint;
    } else {
      const arrayBuffer = await req.arrayBuffer();
      audioBlob = new Blob([arrayBuffer], { type: "audio/webm" });
    }

    const adapter = getAIAdapter();
    const result = await adapter.transcribeAudio(audioBlob, languageHint);

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Transcription error:", error);
    return new Response(JSON.stringify({ error: error.message || "Failed to transcribe audio" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
