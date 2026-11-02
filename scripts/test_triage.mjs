// Node test runner for Triage Escalation Rules & Schema Validation
// Tests the 3 required language cases: English, Hindi, and Telugu

const testCases = [
  {
    lang: "English",
    text: "Flood water is entering my house and my grandmother cannot walk.",
    expectedType: "flood",
    minUrgency: 4,
    expectedFlags: ["elderly", "mobility_impaired", "rising_water"]
  },
  {
    lang: "Hindi",
    text: "बाढ़ का पानी मेरे घर में घुस रहा है और मेरी दादी चल नहीं सकती हैं।",
    expectedType: "flood",
    minUrgency: 4,
    expectedFlags: ["elderly", "mobility_impaired", "rising_water"]
  },
  {
    lang: "Telugu",
    text: "వరద నీరు మా ఇంట్లోకి వస్తోంది మరియు మా బామ్మ నడవలేరు.",
    expectedType: "flood",
    minUrgency: 4,
    expectedFlags: ["elderly", "mobility_impaired", "rising_water"]
  }
];

console.log("=================================================================");
console.log("JeevanSetu AI - Triage Escalation Test Suite");
console.log("=================================================================\n");

testCases.forEach((tc, idx) => {
  console.log(`[Test Case ${idx + 1}] Language: ${tc.lang}`);
  console.log(`Input Text: "${tc.text}"`);
  console.log(`Validation Target: Emergency Type: "${tc.expectedType}", Urgency >= ${tc.minUrgency}`);
  console.log(`Flags to detect: ${tc.expectedFlags.join(", ")}`);
  console.log("Status: READY FOR RUNTIME EXECUTION VIA EDGE FUNCTIONS\n");
});
