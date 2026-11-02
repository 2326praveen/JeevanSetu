import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

export const EmergencyTypeSchema = z.enum([
  "flood",
  "cyclone",
  "landslide",
  "fire",
  "earthquake",
  "medical",
  "other"
]);

export const TriageOutputSchema = z.object({
  emergency_type: EmergencyTypeSchema,
  urgency: z.number().int().min(1).max(5),
  people_at_risk: z.number().int().min(1).default(1),
  vulnerable_flags: z.array(z.string()).default([]),
  location_text: z.string().nullable().default(""),
  english_summary: z.string(),
  reply_in_user_language: z.string(),
  detected_language: z.string().default("en")
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export const FallbackTriage: TriageOutput = {
  emergency_type: "other",
  urgency: 3,
  people_at_risk: 1,
  vulnerable_flags: [],
  location_text: "",
  english_summary: "Emergency report received. Triage in progress by authority.",
  reply_in_user_language: "आपकी आपातकालीन सूचना प्राप्त हो गई है। बचाव दल को सूचित किया जा रहा है। (Emergency received, response team alerted)",
  detected_language: "en"
};

/**
 * Enforces safety rule:
 * If the text mentions elderly, child, disabled, pregnant, trapped, or rising water, urgency must be >= 4.
 */
export function enforceVulnerabilityEscalation(text: string, triage: TriageOutput): TriageOutput {
  const lower = text.toLowerCase();
  
  // Multilingual keyword triggers (English, Hindi, Telugu, Tamil, Kannada, etc.)
  const highRiskKeywords = [
    // English
    "elderly", "grandmother", "grandfather", "grandma", "grandpa", "old man", "old woman", "aged", "senior",
    "child", "baby", "infant", "toddler", "kids", "children",
    "disabled", "cannot walk", "wheelchair", "bedridden", "paralyzed", "blind", "handicapped",
    "pregnant", "pregnancy", "labor", "delivery",
    "trapped", "stuck", "roof", "marooned", "collapsed",
    "rising water", "water entering", "flood water", "drowning", "surge",
    // Hindi keywords / transliterations
    "बूढ़े", "बुजुर्ग", "दादी", "नानी", "दादा", "बच्चा", "शिशु", "गर्भवती", "फंसे", "बाढ़", "पानी भर रहा", "चल नहीं",
    "bujurg", "dadi", "nani", "dada", "bacha", "garbhwati", "fanse", "paani bhar",
    // Telugu keywords / transliterations
    "ముసలి", "బామ్మ", "తాతయ్య", "పిల్లలు", "గర్భవతి", "నడవలేరు", "నీళ్లు వస్తున్నాయి", "వరద", "చిక్కుకు",
    "baamma", "thatayya", "pillalu", "garbhavati", "nadavaleru", "neellu", "varada", "chikku"
  ];

  const detectedFlags = new Set<string>(triage.vulnerable_flags || []);
  let shouldEscalate = false;

  for (const kw of highRiskKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      shouldEscalate = true;
      if (kw.includes("grand") || kw.includes("elder") || kw.includes("old") || kw.includes("दादी") || kw.includes("బామ్మ")) {
        detectedFlags.add("elderly");
      }
      if (kw.includes("child") || kw.includes("baby") || kw.includes("infant") || kw.includes("बच्चा") || kw.includes("పిల్లలు")) {
        detectedFlags.add("child");
      }
      if (kw.includes("disabled") || kw.includes("walk") || kw.includes("wheelchair") || kw.includes("चल नहीं") || kw.includes("నడవలేరు")) {
        detectedFlags.add("mobility_impaired");
      }
      if (kw.includes("pregnant") || kw.includes("गर्भवती") || kw.includes("గర్భవతి")) {
        detectedFlags.add("pregnant");
      }
      if (kw.includes("trapped") || kw.includes("stuck") || kw.includes("roof") || kw.includes("फंसे") || kw.includes("చిక్కు")) {
        detectedFlags.add("trapped");
      }
      if (kw.includes("water") || kw.includes("flood") || kw.includes("बाढ़") || kw.includes("వరద")) {
        detectedFlags.add("rising_water");
      }
    }
  }

  let finalUrgency = triage.urgency;
  if (shouldEscalate && finalUrgency < 4) {
    finalUrgency = 4;
  }
  // If extreme combinations (e.g. rising water + immobile/elderly trapped), elevate to maximum 5
  if ((detectedFlags.has("rising_water") || detectedFlags.has("trapped")) && 
      (detectedFlags.has("elderly") || detectedFlags.has("mobility_impaired") || detectedFlags.has("pregnant") || detectedFlags.has("child"))) {
    finalUrgency = 5;
  }

  return {
    ...triage,
    urgency: finalUrgency,
    vulnerable_flags: Array.from(detectedFlags)
  };
}
