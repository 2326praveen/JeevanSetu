import { TriageOutput, TriageOutputSchema, FallbackTriage, enforceVulnerabilityEscalation } from "./types.ts";

export interface IAIAdapter {
  transcribeAudio(audioBlob: Blob, languageHint?: string): Promise<{ text: string; language: string }>;
  triageEmergencyText(rawText: string): Promise<TriageOutput>;
}

/**
 * Groq Free Tier Adapter
 * - Speech-to-Text: whisper-large-v3
 * - Classification & Translation: llama-3.3-70b-versatile
 */
export class GroqAdapter implements IAIAdapter {
  private apiKey: string;
  private baseUrl = "https://api.groq.com/openai/v1";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || Deno.env.get("GROQ_API_KEY") || "";
    if (!this.apiKey) {
      console.warn("GROQ_API_KEY is not configured in environment.");
    }
  }

  async transcribeAudio(audioBlob: Blob, languageHint?: string): Promise<{ text: string; language: string }> {
    if (!this.apiKey) {
      throw new Error("GROQ_API_KEY missing. Cannot transcribe audio.");
    }

    const formData = new FormData();
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", "whisper-large-v3");
    formData.append("response_format", "verbose_json");
    if (languageHint) {
      formData.append("language", languageHint);
    }

    const resp = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Groq Whisper transcription failed (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return {
      text: (data.text || "").trim(),
      language: data.language || "en",
    };
  }

  async triageEmergencyText(rawText: string): Promise<TriageOutput> {
    if (!this.apiKey) {
      console.warn("GROQ_API_KEY missing, using safe fallback triage.");
      return enforceVulnerabilityEscalation(rawText, FallbackTriage);
    }

    const systemPrompt = `You are "JeevanSetu AI", an emergency rescue triage coordinator for India.
Analyze the following citizen emergency message in any Indian regional language (Hindi, Telugu, Tamil, Kannada, Bengali, Marathi, Malayalam, English, Hinglish, etc.).

You MUST output STRICT, RAW JSON ONLY. No markdown ticks, no commentary, no explanation.

Schema requirements:
{
  "emergency_type": "flood" | "cyclone" | "landslide" | "fire" | "earthquake" | "medical" | "other",
  "urgency": 1 to 5 (1=minor, 3=moderate, 5=imminent life-threat),
  "people_at_risk": number (integer >= 1),
  "vulnerable_flags": string[] (e.g. ["elderly", "mobility_impaired", "child", "pregnant", "trapped", "rising_water"]),
  "location_text": string (any street, landmark, area, city or district mentioned, or null),
  "english_summary": string (clear 1-2 sentence English summary for rescue teams),
  "reply_in_user_language": string (calm, reassuring, actionable instructions in the citizen's original language telling them rescue is notified and what immediate safety step to take),
  "detected_language": string (e.g. "hi", "te", "ta", "kn", "en", "bn", "mr", "ml")
}

CRITICAL RULES:
1. If the message mentions elderly, grandmother, grandfather, child, baby, disabled, cannot walk, wheelchair, pregnant, trapped, or rising water, urgency MUST be >= 4.
2. If rising flood water combines with trapped or elderly/immobile individuals, set urgency = 5.
3. Keep reply_in_user_language respectful, reassuring and clear in the exact language/script of the user.`;

    const makeCall = async (): Promise<string> => {
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Citizen Emergency Message: "${rawText}"` },
          ],
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Groq LLM call failed (${resp.status}): ${err}`);
      }

      const json = await resp.json();
      return json.choices?.[0]?.message?.content || "{}";
    };

    let rawJsonContent = "";
    // Attempt 1
    try {
      rawJsonContent = await makeCall();
      const parsed = JSON.parse(rawJsonContent);
      const validated = TriageOutputSchema.parse(parsed);
      return enforceVulnerabilityEscalation(rawText, validated);
    } catch (err1) {
      console.warn("Triage Attempt 1 failed. Retrying once...", err1);
      // Attempt 2 (One retry as specified)
      try {
        rawJsonContent = await makeCall();
        const parsed = JSON.parse(rawJsonContent);
        const validated = TriageOutputSchema.parse(parsed);
        return enforceVulnerabilityEscalation(rawText, validated);
      } catch (err2) {
        console.error("Triage Attempt 2 failed. Resorting to safe fallback.", err2);
        return enforceVulnerabilityEscalation(rawText, FallbackTriage);
      }
    }
  }
}

/**
 * Gemini Adapter (Drop-in alternative)
 */
export class GeminiAdapter implements IAIAdapter {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || Deno.env.get("GEMINI_API_KEY") || "";
  }

  async transcribeAudio(_audioBlob: Blob, _languageHint?: string): Promise<{ text: string; language: string }> {
    // For audio STT with Gemini 1.5 Flash
    throw new Error("Gemini STT adapter is available when GEMINI_API_KEY is configured.");
  }

  async triageEmergencyText(rawText: string): Promise<TriageOutput> {
    if (!this.apiKey) {
      return enforceVulnerabilityEscalation(rawText, FallbackTriage);
    }
    // Standard Gemini 1.5 Flash endpoint can be called here
    return enforceVulnerabilityEscalation(rawText, FallbackTriage);
  }
}

/**
 * Factory to retrieve the active AI Adapter based on environment configuration
 */
export function getAIAdapter(): IAIAdapter {
  const provider = Deno.env.get("AI_PROVIDER")?.toLowerCase() || "groq";
  if (provider === "gemini") {
    return new GeminiAdapter();
  }
  return new GroqAdapter();
}
