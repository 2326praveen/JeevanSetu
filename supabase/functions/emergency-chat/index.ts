import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { geocodeLocationText } from "../_shared/nominatim.ts";
import { checkRateLimit } from "../_shared/rateLimiter.ts";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface EmergencyExtraction {
  is_emergency: boolean;
  emergency_type: "flood" | "cyclone" | "landslide" | "fire" | "earthquake" | "medical" | "other";
  urgency: number;
  people_at_risk: number;
  vulnerable_flags: string[];
  location_text: string | null;
  ready_to_dispatch: boolean;
}

interface ChatAIResponse {
  reply: string;
  detected_language: string;
  language_name: string;
  english_summary: string;
  emergency_extracted: EmergencyExtraction;
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { allowed } = checkRateLimit(req, 30);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Rate limit reached. Please wait a moment." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const message = (body.message || body.text || "").trim();
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];
    let lat: number | null = body.lat !== undefined && body.lat !== null ? parseFloat(body.lat) : null;
    let lng: number | null = body.lng !== undefined && body.lng !== null ? parseFloat(body.lng) : null;
    const sessionToken: string = body.session_token || "";

    if (!message && history.length === 0) {
      return new Response(JSON.stringify({ error: "Message text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groqApiKey = Deno.env.get("GROQ_API_KEY") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    // 1. Process conversation with Groq llama-3.3-70b-versatile
    const aiResult = await processEmergencyChat(message, history, groqApiKey);

    let ticket: any = null;
    let nearbyFacilities: any[] = [];

    // 2. Automated Dispatch / Ticket Generation if emergency details are ready
    if (aiResult.emergency_extracted.ready_to_dispatch && supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Resolve coordinates if missing using geocoding
      if ((lat === null || lng === null || isNaN(lat) || isNaN(lng)) && aiResult.emergency_extracted.location_text) {
        const geo = await geocodeLocationText(aiResult.emergency_extracted.location_text);
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
        }
      }

      // Default fallback coordinates if location still unknown (Central Bengaluru)
      const finalLat = lat !== null && !isNaN(lat) ? lat : 12.9716;
      const finalLng = lng !== null && !isNaN(lng) ? lng : 77.5946;

      const { data: createdTicket, error: ticketErr } = await supabase
        .from("tickets")
        .insert({
          channel: "app",
          original_text: message,
          original_language: aiResult.detected_language,
          translated_text_en: aiResult.english_summary,
          emergency_type: aiResult.emergency_extracted.emergency_type,
          urgency: aiResult.emergency_extracted.urgency,
          people_at_risk: aiResult.emergency_extracted.people_at_risk,
          vulnerable_flags: aiResult.emergency_extracted.vulnerable_flags,
          lat: finalLat,
          lng: finalLng,
          address_text: aiResult.emergency_extracted.location_text || "Reported via AI Assistant",
          status: "new",
          ai_summary: aiResult.english_summary,
          reply_in_user_language: aiResult.reply,
        })
        .select()
        .single();

      if (!ticketErr && createdTicket) {
        ticket = createdTicket;

        // Audit Event
        await supabase.from("ticket_events").insert({
          ticket_id: ticket.id,
          actor: "assistant_multilingual_ai",
          event: "ticket_created_via_chat",
          metadata: {
            language: aiResult.detected_language,
            urgency: aiResult.emergency_extracted.urgency,
            session_token: sessionToken,
          },
        });

        // Fetch nearest facilities via Haversine RPC
        const { data: facs } = await supabase.rpc("nearest_facilities", {
          user_lat: finalLat,
          user_lng: finalLng,
          facility_type: null,
          max_results: 3,
        });

        if (facs) nearbyFacilities = facs;

        // Link chat session if table exists
        if (sessionToken) {
          await supabase
            .from("chat_sessions")
            .upsert({
              session_token: sessionToken,
              ticket_id: ticket.id,
              detected_language: aiResult.detected_language,
              is_dispatched: true,
              updated_at: new Date().toISOString(),
            }, { onConflict: "session_token" });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        reply: aiResult.reply,
        detected_language: aiResult.detected_language,
        language_name: aiResult.language_name,
        english_summary: aiResult.english_summary,
        emergency_extracted: aiResult.emergency_extracted,
        ticket,
        nearby_facilities: nearbyFacilities,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Emergency chat error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Failed to process chat message" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function processEmergencyChat(
  latestMessage: string,
  history: ChatMessage[],
  apiKey: string
): Promise<ChatAIResponse> {
  const languageHints = detectLanguageScript(latestMessage);

  if (apiKey) {
    try {
      const systemPrompt = `You are "JeevanSetu AI Multilingual Emergency Assistant", India's official AI emergency rescue and disaster coordinator.

CRITICAL INSTRUCTIONS:
1. DETECT THE USER'S LANGUAGE:
   You must identify the citizen's language (Telugu, Hindi, Tamil, Kannada, Bengali, Marathi, Malayalam, English, Hinglish).
2. RESPOND IN THE EXACT SAME LANGUAGE AND SCRIPT:
   - If user wrote in Telugu (తెలుగు), respond in Telugu script.
   - If user wrote in Hindi (हिंदी), respond in Devanagari script.
   - If user wrote in Tamil (தமிழ்), respond in Tamil script.
   - If user wrote in Kannada (ಕನ್ನಡ), respond in Kannada script.
   - If user wrote in Bengali (বাংলা), respond in Bengali script.
   - If user wrote in Marathi (मराठी), respond in Marathi script.
   - If user wrote in Malayalam (മലയാളം), respond in Malayalam script.
   - If user wrote in English or Romanized transliteration (e.g. Hinglish, Telugu in English alphabet), respond in clear reassuring language.
3. TONE & BEHAVIOR:
   - Be calm, reassuring, empathetic, and urgent.
   - Provide immediate lifesaving guidance (e.g. move to higher ground, switch off main breaker, stay away from power cables, elevate elderly).
   - If the situation is an emergency, extract all parameters. Set ready_to_dispatch=true if hazard type and basic condition or location are clear.
4. VULNERABILITY ESCALATION:
   - If message mentions grandmother/grandfather/elderly, children/babies, pregnant woman, disabled/cannot walk, trapped on roof, or rising water, set urgency >= 4 (or 5 if combined with rising water).

STRICT OUTPUT FORMAT:
You MUST respond with RAW, PARSEABLE JSON ONLY. No markdown ticks, no preamble.
Schema:
{
  "reply": "reassuring, actionable response in the user's exact regional language and script",
  "detected_language": "te" | "hi" | "ta" | "kn" | "bn" | "mr" | "ml" | "en",
  "language_name": "Telugu" | "Hindi" | "Tamil" | "Kannada" | "Bengali" | "Marathi" | "Malayalam" | "English",
  "english_summary": "Concise 1-2 sentence English summary for emergency dispatchers",
  "emergency_extracted": {
    "is_emergency": true,
    "emergency_type": "flood" | "cyclone" | "landslide" | "fire" | "earthquake" | "medical" | "other",
    "urgency": 1 to 5,
    "people_at_risk": 1,
    "vulnerable_flags": ["elderly", "rising_water"],
    "location_text": "Extracted street/city/landmark or null",
    "ready_to_dispatch": true
  }
}`;

      const conversation = [
        ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: latestMessage },
      ];

      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            ...conversation,
          ],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          return enforceChatSafetyRules(latestMessage, parsed);
        }
      }
    } catch (e) {
      console.warn("Groq chat assistant error, using fallback:", e);
    }
  }

  // Graceful rule-based multilingual fallback
  return getRuleBasedChatFallback(latestMessage, languageHints);
}

function detectLanguageScript(text: string): { code: string; name: string } {
  // Unicode range checks
  if (/[\u0C00-\u0C7F]/.test(text)) return { code: "te", name: "Telugu" };
  if (/[\u0B80-\u0BFF]/.test(text)) return { code: "ta", name: "Tamil" };
  if (/[\u0C80-\u0CFF]/.test(text)) return { code: "kn", name: "Kannada" };
  if (/[\u0980-\u09FF]/.test(text)) return { code: "bn", name: "Bengali" };
  if (/[\u0D00-\u0D7F]/.test(text)) return { code: "ml", name: "Malayalam" };
  if (/[\u0900-\u097F]/.test(text)) {
    // Distinguish Marathi vs Hindi (check common Marathi words, avoiding ASCII \b)
    if (/(आहे|आहोत|नाही|झाले|पाणी|मदत|घरात|अडकलो|करावे)/.test(text)) {
      return { code: "mr", name: "Marathi" };
    }
    return { code: "hi", name: "Hindi" };
  }
  return { code: "en", name: "English" };
}

function enforceChatSafetyRules(text: string, parsed: any): ChatAIResponse {
  const lower = text.toLowerCase();
  const vulnerableFlags = new Set<string>(parsed.emergency_extracted?.vulnerable_flags || []);
  let urgency = Number(parsed.emergency_extracted?.urgency || 3);

  // Multilingual Vulnerability Escalation keywords
  if (
    lower.includes("grandmother") || lower.includes("grandfather") || lower.includes("elderly") ||
    lower.includes("దాది") || lower.includes("బామ్మ") || lower.includes("తాతయ్య") ||
    lower.includes("दादी") || lower.includes("नानी") || lower.includes("दादा") ||
    lower.includes("பாட்டி") || lower.includes("தாத்தா") || lower.includes("ಅಜ್ಜಿ")
  ) {
    vulnerableFlags.add("elderly");
    urgency = Math.max(urgency, 4);
  }

  if (
    lower.includes("cannot walk") || lower.includes("wheelchair") || lower.includes("disabled") ||
    lower.includes("నడవలేరు") || lower.includes("चल नहीं") || lower.includes("நடக்க முடியாது")
  ) {
    vulnerableFlags.add("mobility_impaired");
    urgency = Math.max(urgency, 4);
  }

  if (
    lower.includes("rising water") || lower.includes("flood water") || lower.includes("drowning") ||
    lower.includes("వరద నీరు") || lower.includes("पानी भर") || lower.includes("வெள்ள நீர்")
  ) {
    vulnerableFlags.add("rising_water");
    if (vulnerableFlags.has("elderly") || vulnerableFlags.has("mobility_impaired") || vulnerableFlags.has("trapped")) {
      urgency = 5;
    }
  }

  return {
    reply: parsed.reply || "Help is on the way. Please stay in a safe elevated location.",
    detected_language: parsed.detected_language || "en",
    language_name: parsed.language_name || "English",
    english_summary: parsed.english_summary || text,
    emergency_extracted: {
      is_emergency: parsed.emergency_extracted?.is_emergency ?? true,
      emergency_type: parsed.emergency_extracted?.emergency_type || "flood",
      urgency,
      people_at_risk: Number(parsed.emergency_extracted?.people_at_risk || 1),
      vulnerable_flags: Array.from(vulnerableFlags),
      location_text: parsed.emergency_extracted?.location_text || null,
      ready_to_dispatch: parsed.emergency_extracted?.ready_to_dispatch ?? true,
    },
  };
}

function getRuleBasedChatFallback(
  text: string,
  lang: { code: string; name: string }
): ChatAIResponse {
  const isFlood = /flood|water|వరద|नीళ్లు|पानी|வெள்ளம்|ನೀರು|জল|पाणी|വെള്ളം/i.test(text);
  const isFire = /fire|తీ|आग|தீ|ಬೆಂಕಿ|আগুন|आग|തീ/i.test(text);
  const type = isFire ? "fire" : isFlood ? "flood" : "other";

  const responses: Record<string, string> = {
    te: "ధైర్యంగా ఉండండి, మేము రక్షణ బృందాన్ని హెచ్చరించాము. దయచేసి ఎత్తైన ప్రదేశంలో ఉండండి మరియు విద్యుత్ మెయిన్లను ఆపివేయండి.",
    hi: "घबराएं नहीं, आपकी आपातकालीन सूचना नियंत्रण कक्ष को भेज दी गई है। कृपया सुरक्षित ऊंचे स्थान पर रहें और बिजली का मेन स्विच बंद रखें।",
    ta: "பயப்பட வேண்டாம், அவசர மீட்புக் குழுவுக்கு தகவல் அனுப்பப்பட்டுள்ளது. தயவுசெய்து உயரமான இடத்திற்குச் சென்று மின் இணைப்பைத் துண்டிக்கவும்.",
    kn: "ಧೈರ್ಯವಾಗಿರಿ, ರಕ್ಷಣಾ ತಂಡಕ್ಕೆ ಮಾಹಿತಿ ರವಾನಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಎತ್ತರದ ಸ್ಥಳದಲ್ಲಿರಿ ಮತ್ತು ವಿದ್ಯುತ್ ಸಂಪರ್ಕವನ್ನು ಕಡಿತಗೊಳಿಸಿ.",
    bn: "ভয় পাবেন না, জরুরি উদ্ধারকারী দলকে জানানো হয়েছে। দয়া করে উঁচু স্থানে থাকুন এবং বিদ্যুতের মেইন সুইচ বন্ধ রাখুন।",
    mr: "घाबरू नका, आपत्कालीन मदत पथकाला कळवण्यात आले आहे. कृपया सुरक्षित आणि उंचावर राहा आणि विजेचा मुख्य स्विच बंद करा.",
    ml: "പരിഭ്രാന്തരാകരുത്, രക്ഷാപ്രവർത്തകർക്ക് വിവരം നൽകിയിട്ടുണ്ട്. ദയവായി ഉയർന്ന സുരക്ഷിത സ്ഥാനത്തേക്ക് മാറുക.",
    en: "Stay calm. Emergency rescue teams have been alerted. Please move to an elevated safe position and disconnect electricity mains.",
  };

  return {
    reply: responses[lang.code] || responses.en,
    detected_language: lang.code,
    language_name: lang.name,
    english_summary: `Citizen reported ${type} emergency via assistant chat in ${lang.name}.`,
    emergency_extracted: {
      is_emergency: true,
      emergency_type: type as any,
      urgency: 4,
      people_at_risk: 1,
      vulnerable_flags: ["rising_water"],
      location_text: null,
      ready_to_dispatch: true,
    },
  };
}
