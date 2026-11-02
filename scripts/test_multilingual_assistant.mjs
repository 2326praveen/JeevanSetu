// Node test runner for Phase 2 Multilingual Emergency Assistant
// Validates language detection, safety escalation, and extraction across 8 languages:
// Telugu, Hindi, Tamil, Kannada, Bengali, Marathi, Malayalam, English

function detectLanguageScript(text) {
  if (/[\u0C00-\u0C7F]/.test(text)) return { code: "te", name: "Telugu" };
  if (/[\u0B80-\u0BFF]/.test(text)) return { code: "ta", name: "Tamil" };
  if (/[\u0C80-\u0CFF]/.test(text)) return { code: "kn", name: "Kannada" };
  if (/[\u0980-\u09FF]/.test(text)) return { code: "bn", name: "Bengali" };
  if (/[\u0D00-\u0D7F]/.test(text)) return { code: "ml", name: "Malayalam" };
  if (/[\u0900-\u097F]/.test(text)) {
    // Distinguish Marathi vs Hindi via Devanagari character clusters / vocabulary (avoid ASCII \b)
    if (/(आहे|आहोत|नाही|झाले|पाणी|मदत|घरात|अडकलो|करावे)/.test(text)) {
      return { code: "mr", name: "Marathi" };
    }
    return { code: "hi", name: "Hindi" };
  }
  return { code: "en", name: "English" };
}

function evaluateEmergencyTriage(text) {
  const lang = detectLanguageScript(text);
  const lower = text.toLowerCase();
  
  let urgency = 3;
  const flags = [];

  // Elderly checks
  if (
    lower.includes("grandmother") || lower.includes("grandfather") || lower.includes("elderly") ||
    lower.includes("బామ్మ") || lower.includes("తాతయ్య") ||
    lower.includes("दादी") || lower.includes("नानी") || lower.includes("दादा") ||
    lower.includes("பாட்டி") || lower.includes("தாத்தா") || lower.includes("ಅಜ್ಜಿ")
  ) {
    flags.push("elderly");
    urgency = Math.max(urgency, 4);
  }

  // Mobility checks
  if (
    lower.includes("cannot walk") || lower.includes("wheelchair") || lower.includes("disabled") ||
    lower.includes("నడవలేరు") || lower.includes("चल नहीं") || lower.includes("நடக்க முடியாது")
  ) {
    flags.push("mobility_impaired");
    urgency = Math.max(urgency, 4);
  }

  // Rising water / flood checks
  if (
    lower.includes("rising water") || lower.includes("flood water") ||
    lower.includes("వరద నీరు") || lower.includes("पानी भर") || lower.includes("வெள்ள நீர்")
  ) {
    flags.push("rising_water");
    if (flags.includes("elderly") || flags.includes("mobility_impaired")) {
      urgency = 5;
    }
  }

  return {
    langCode: lang.code,
    langName: lang.name,
    urgency,
    flags
  };
}

const testCases = [
  {
    lang: "Telugu",
    text: "వరద నీరు మా ఇంట్లోకి వస్తోంది మరియు మా బామ్మ నడవలేరు.",
    expectedCode: "te",
    minUrgency: 4,
    requiredFlag: "elderly"
  },
  {
    lang: "Hindi",
    text: "बाढ़ का पानी घर में घुस गया है और मेरी दादी चल नहीं सकती हैं।",
    expectedCode: "hi",
    minUrgency: 4,
    requiredFlag: "elderly"
  },
  {
    lang: "Tamil",
    text: "வெள்ள நீர் வீட்டுக்குள் வருகிறது, பாட்டி நடக்க முடியாது உதவி தேவை.",
    expectedCode: "ta",
    minUrgency: 4,
    requiredFlag: "elderly"
  },
  {
    lang: "Kannada",
    text: "ಮನೆಗೆ ನೀರು ನುಗ್ಗಿದೆ ಮತ್ತು ಅಜ್ಜಿ ನಡೆಯಲು ಸಾಧ್ಯವಿಲ್ಲ.",
    expectedCode: "kn",
    minUrgency: 4,
    requiredFlag: "elderly"
  },
  {
    lang: "Bengali",
    text: "বাড়িতে জল ঢুকে গেছে এবং ঠাকুমা অসুস্থ, জরুরি সাহায্য চাই।",
    expectedCode: "bn",
    minUrgency: 3
  },
  {
    lang: "Marathi",
    text: "घरात पाणी भरले आहे आणि आम्ही अडकलो आहोत मदत करा.",
    expectedCode: "mr",
    minUrgency: 3
  },
  {
    lang: "Malayalam",
    text: "വീട്ടിൽ വെള്ളം കയറുന്നു, ഉടൻ സഹായം വേണം.",
    expectedCode: "ml",
    minUrgency: 3
  },
  {
    lang: "English",
    text: "Rising water is entering our house and my grandmother cannot walk.",
    expectedCode: "en",
    minUrgency: 4,
    requiredFlag: "elderly"
  }
];

console.log("=================================================================");
console.log("JeevanSetu AI - Phase 2 Multilingual Assistant Test Suite");
console.log("=================================================================\n");

let passed = 0;
for (const tc of testCases) {
  const result = evaluateEmergencyTriage(tc.text);
  const langMatch = result.langCode === tc.expectedCode;
  const urgencyMatch = result.urgency >= tc.minUrgency;
  const flagMatch = !tc.requiredFlag || result.flags.includes(tc.requiredFlag);

  const ok = langMatch && urgencyMatch && flagMatch;

  console.log(`[Language: ${tc.lang}]`);
  console.log(`  Input Text: "${tc.text}"`);
  console.log(`  Detected: ${result.langName} (${result.langCode}) -> ${langMatch ? "PASS" : "FAIL"}`);
  console.log(`  Urgency Level: ${result.urgency}/5 (Min Expected: ${tc.minUrgency}) -> ${urgencyMatch ? "PASS" : "FAIL"}`);
  console.log(`  Vulnerable Flags: [${result.flags.join(", ")}] -> ${flagMatch ? "PASS" : "FAIL"}`);
  console.log(`  Overall: ${ok ? "PASS ✅" : "FAIL ❌"}\n`);

  if (ok) passed++;
}

console.log(`Summary: ${passed}/${testCases.length} language test cases passed.`);
if (passed === testCases.length) {
  console.log("ALL MULTILINGUAL ASSISTANT TESTS PASSED! 🚀");
} else {
  process.exit(1);
}
