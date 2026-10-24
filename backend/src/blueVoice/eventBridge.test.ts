import test from "node:test";
import assert from "node:assert/strict";
import { canonicalVoiceEvent } from "./eventBridge";

const basic = {
  callId: 24,
  sessionId: 3,
  from: "+55 (11) 99999-0000",
  direction: "incoming" as const,
  timestamp: Date.parse("2026-10-23T20:00:00Z"),
  durationSec: 91,
};

test("stable event key for exact provider call identity", () => {
  const event = canonicalVoiceEvent("voice.call.completed", basic)!;
  assert.equal(event.event_id, "pabx:3:24:voice.call.completed");
  assert.equal(event.provider_call_id, "pabx:3:24");
  assert.equal(event.phone_number, "5511999990000");
  assert.equal(event.duration_seconds, 91);
  assert.equal(event.recording_status, "none");
});

test("recording readiness is metadata-only and never transports media URL", () => {
  const event = canonicalVoiceEvent("voice.recording.ready", basic)!;
  assert.equal(event.recording_status, "ready");
  assert.ok(!("recording_reference" in event));
  assert.ok(!("raw" in event));
});

test("no event without an exact persisted call identity", () => {
  assert.equal(canonicalVoiceEvent("voice.call.completed", { ...basic, callId: undefined }), null);
  assert.equal(canonicalVoiceEvent("voice.call.created", { ...basic, sessionId: 0 }), null);
});

test("phone out of range is not published", () => {
  const event = canonicalVoiceEvent("voice.call.missed", { ...basic, from: "123" })!;
  assert.equal(event.phone_number, null);
});
