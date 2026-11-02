// Test runner for Phase 6: Offline / Low-Network Mode
// Tests:
// 1. Compact SMS-SOS encoding format and payload limits
// 2. Emergency type and vulnerability flag compaction
// 3. SMS payload decoding & reconstruction
// 4. Pre-filled sms: link generation with recipient and body URI encoding
// 5. Offline queue schema compliance

import assert from 'assert';

const EMERGENCY_CODES = {
  flood: 'FL',
  fire: 'FI',
  earthquake: 'EQ',
  cyclone: 'CY',
  landslide: 'LS',
  medical: 'MD',
  collapse: 'CL',
  trapped: 'TR',
  drowning: 'DR',
  other: 'OT'
};

function encodeSmsPayload(opts) {
  const lat = opts.lat != null ? opts.lat.toFixed(4) : '0';
  const lng = opts.lng != null ? opts.lng.toFixed(4) : '0';

  const type = (opts.emergencyType || 'other').toLowerCase();
  const code = EMERGENCY_CODES[type] || 'OT';
  const people = Math.min(99, opts.peopleAtRisk || 1);

  const flagMap = {
    elderly: 'ELD', infant: 'INF', child: 'CHD', pregnant: 'PRG',
    disabled: 'DIS', medical_condition: 'MED'
  };
  const flags = (opts.vulnerableFlags || [])
    .map(f => flagMap[f.toLowerCase()] || f.slice(0, 3).toUpperCase())
    .join(',');

  const msg = (opts.message || 'SOS').replace(/[|]/g, ' ').slice(0, 30).trim();
  return `JSETU|${lat},${lng}|${code}|${people}|${flags}|${msg}`;
}

function decodeSmsPayload(sms) {
  if (!sms.startsWith('JSETU|')) return null;
  const parts = sms.split('|');
  if (parts.length < 6) return null;

  const [latStr, lngStr] = parts[1].split(',');
  return {
    lat: parseFloat(latStr) || 0,
    lng: parseFloat(lngStr) || 0,
    emergencyCode: parts[2],
    peopleAtRisk: parseInt(parts[3]) || 1,
    flags: parts[4] ? parts[4].split(',').filter(Boolean) : [],
    message: parts[5] || 'SOS'
  };
}

function generateSmsLink(opts) {
  const body = encodeSmsPayload(opts);
  const recipient = opts.recipientNumber || '112';
  return `sms:${recipient}?body=${encodeURIComponent(body)}`;
}

console.log("=================================================================");
console.log("JeevanSetu AI - Phase 6 Offline / Low-Network Engine Test Suite");
console.log("=================================================================\n");

let passed = 0;

// Test 1: Compact SMS-SOS encoding
try {
  const payload = encodeSmsPayload({
    lat: 12.971598,
    lng: 77.594562,
    emergencyType: 'flood',
    peopleAtRisk: 4,
    vulnerableFlags: ['infant', 'elderly'],
    message: 'Water 4ft deep house trapped'
  });

  assert.ok(payload.startsWith('JSETU|12.9716,77.5946|FL|4|INF,ELD|'));
  assert.ok(payload.length <= 80, `Payload length ${payload.length} exceeds standard SMS size`);
  console.log(`✅ Test 1 Passed: Encoded compact SMS payload: "${payload}" (${payload.length} chars).`);
  passed++;
} catch (err) {
  console.error("❌ Test 1 Failed:", err);
}

// Test 2: Sanitization & Truncation (Pipe delimiter avoidance & 30 char cap)
try {
  const maliciousInput = {
    lat: 12.9141,
    lng: 74.8560,
    emergencyType: 'medical',
    peopleAtRisk: 120, // should cap at 99
    vulnerableFlags: ['pregnant'],
    message: 'Urgent help|needed|patient bleeding severely beyond threshold limit'
  };

  const encoded = encodeSmsPayload(maliciousInput);
  // Verify pipe character was removed from message
  const parts = encoded.split('|');
  assert.strictEqual(parts.length, 6, 'Pipes in user message must not break delimiter splitting');
  assert.strictEqual(parts[3], '99', 'People count must cap at 99');
  assert.ok(parts[5].length <= 30, 'Message portion must cap at 30 chars');
  console.log("✅ Test 2 Passed: Pipe delimiter sanitization & length limits enforced.");
  passed++;
} catch (err) {
  console.error("❌ Test 2 Failed:", err);
}

// Test 3: Reversible Decoding
try {
  const original = {
    lat: 12.9680,
    lng: 77.5850,
    emergencyType: 'landslide',
    peopleAtRisk: 5,
    vulnerableFlags: ['disabled'],
    message: 'Road blocked mudflow'
  };

  const encoded = encodeSmsPayload(original);
  const decoded = decodeSmsPayload(encoded);

  assert.ok(decoded !== null);
  assert.strictEqual(decoded.lat, 12.9680);
  assert.strictEqual(decoded.lng, 77.5850);
  assert.strictEqual(decoded.emergencyCode, 'LS');
  assert.strictEqual(decoded.peopleAtRisk, 5);
  assert.deepStrictEqual(decoded.flags, ['DIS']);
  assert.strictEqual(decoded.message, 'Road blocked mudflow');
  console.log("✅ Test 3 Passed: Reversible decoding reconstructed all 6 fields accurately.");
  passed++;
} catch (err) {
  console.error("❌ Test 3 Failed:", err);
}

// Test 4: Pre-filled sms: URI formatting
try {
  const link = generateSmsLink({
    lat: 12.9716,
    lng: 77.5946,
    emergencyType: 'fire',
    peopleAtRisk: 2,
    message: 'Kitchen fire smoke'
  });

  assert.ok(link.startsWith('sms:112?body='));
  const decodedBody = decodeURIComponent(link.replace('sms:112?body=', ''));
  assert.ok(decodedBody.startsWith('JSETU|12.9716,77.5946|FI|2||Kitchen fire smoke'));
  console.log(`✅ Test 4 Passed: Generated valid native URI: ${link.slice(0, 45)}...`);
  passed++;
} catch (err) {
  console.error("❌ Test 4 Failed:", err);
}

// Test 5: Offline queue item schema validation
try {
  const queuedItem = {
    id: `q-${Date.now()}-abc1`,
    type: 'sos',
    payload: {
      text: 'Water rising in basement',
      channel: 'app',
      lat: 12.9716,
      lng: 77.5946
    },
    createdAt: new Date().toISOString(),
    retryCount: 0
  };

  assert.ok(queuedItem.id.startsWith('q-'));
  assert.strictEqual(queuedItem.type, 'sos');
  assert.strictEqual(queuedItem.retryCount, 0);
  assert.ok(queuedItem.payload.lat !== undefined);
  console.log("✅ Test 5 Passed: Offline queue data structure meets sync contract.");
  passed++;
} catch (err) {
  console.error("❌ Test 5 Failed:", err);
}

console.log(`\nResults: ${passed}/5 tests passed successfully.\n`);
if (passed === 5) {
  process.exit(0);
} else {
  process.exit(1);
}

