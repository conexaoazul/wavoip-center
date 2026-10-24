import test from "node:test";
import assert from "node:assert/strict";
import { resolveRecordingCall } from "./recordingIdentity";

const match = { id: 24, whatsappCallId: "wa-call-24", sessionId: 3 };
function fakeLookup() {
  const lookups: string[] = [];
  const lookup = {
    byId: async (id: number) => { lookups.push("id:" + id); return id === 24 ? match : null; },
    byWhatsappCallId: async (id: string) => {
      lookups.push("wa:" + id); return id === "wa-call-24" ? match : null;
    },
  };
  return { lookups, lookup };
}
test("exact numeric callId matches persisted call", async () => {
  const { lookup, lookups } = fakeLookup();
  const call = await resolveRecordingCall({callId:{value:"24"}}, lookup);
  assert.equal(call?.id, 24);
  assert.deepEqual(lookups, ["id:24"]);
});
test("exact WhatsApp callId matches persisted call", async () => {
  const { lookup, lookups } = fakeLookup();
  const call = await resolveRecordingCall({whatsappCallId:{value:"wa-call-24"}}, lookup);
  assert.equal(call?.id, 24);
  assert.deepEqual(lookups, ["wa:wa-call-24"]);
});
test("matching both IDs works without selecting most recent call", async () => {
  const { lookup } = fakeLookup();
  const call = await resolveRecordingCall({
    whatsappCallId:{value:"wa-call-24"}, callId:{value:"24"},
  }, lookup);
  assert.equal(call?.id, 24);
});
test("divergent IDs fail closed", async () => {
  const { lookup } = fakeLookup();
  const call = await resolveRecordingCall({
    callId:{value:"24"},whatsappCallId:{value:"different"},
  }, lookup);
  assert.equal(call, null);
});
test("missing/unrecognized/invalid IDs fail before lookup", async () => {
  const cases = [
    undefined, {}, {callId:{value:""}}, {callId:{value:"0"}},
    {callId:{value:"24wat"}}, {callId:{value:"9007199254740992"}},
    {callId:{value:"24"},whatsappCallId:{value:"white space"}},
    {whatsappCallId:{value:""}},
  ];
  for (const fields of cases) {
    const { lookup, lookups } = fakeLookup();
    assert.equal(await resolveRecordingCall(fields, lookup), null);
    assert.deepEqual(lookups, []);
  }
});
test("unknown call IDs fail closed with no timestamp fallback", async () => {
  const { lookup, lookups } = fakeLookup();
  assert.equal(await resolveRecordingCall({callId:{value:"25"}},lookup), null);
  assert.deepEqual(lookups, ["id:25"]);
});
