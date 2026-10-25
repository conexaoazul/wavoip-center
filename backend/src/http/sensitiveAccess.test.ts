import test from "node:test";
import assert from "node:assert/strict";
import { requiresSensitivePabxAuth, checkSensitivePabxToken } from "./sensitiveAccess";

test("protects recording uploads, media and transcripts", () => {
  for (const [method, path] of [
    ["POST", "/calls/recording"],
    ["GET", "/calls/24/summary"],
    ["HEAD", "/calls/24/summary"],
    ["GET", "/summaries"],
    ["HEAD", "/uploads?limit=50"],
    ["GET", "/media/recordings/rec-abc.webm"],
    ["HEAD", "/media/recordings/rec-abc.webm"],
    ["GET", "/media%2Frecordings%2Frec-abc.webm"],
    ["GET", "/media%252Frecordings%252Frec-abc.webm"],
    ["GET", "/media\\recordings\\rec-abc.webm"],
  ]) assert.equal(requiresSensitivePabxAuth(method, path), true, path);
});
test("does not alter ordinary static media and web health", () => {
  for (const [method, path] of [
    ["GET", "/health"], ["GET", "/media/welcome.mp3"],
    ["GET", "/calls"], ["POST", "/uploads"],
  ]) assert.equal(requiresSensitivePabxAuth(method, path), false, path);
});
test("no secret, short token, invalid token or non-string header fail closed", () => {
  const secret = "qa-synthetic-token-32-characters-minimum-abcdefgh";
  assert.equal(checkSensitivePabxToken(undefined, secret), false);
  assert.equal(checkSensitivePabxToken("short", "short"), false);
  assert.equal(checkSensitivePabxToken(secret, "wrong"), false);
  assert.equal(checkSensitivePabxToken(secret, [secret]), false);
  assert.equal(checkSensitivePabxToken(secret, secret), true);
});
