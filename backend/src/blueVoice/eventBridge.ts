import axios from "axios";
import { config } from "../config";
import { eventBus, type CallEventPayload } from "../pabx/eventBus";
import { logger } from "../utils/logger";

type VoiceEventType =
  | "voice.call.created"
  | "voice.call.completed"
  | "voice.call.missed"
  | "voice.call.failed"
  | "voice.recording.ready";

type InternalVoiceEvent = {
  schema_version: "1.0";
  provider: "wavoip";
  event_id: string;
  provider_call_id: string;
  event_type: VoiceEventType;
  direction: "incoming" | "outgoing";
  phone_number: string | null;
  duration_seconds: number | null;
  recording_status: "none" | "ready";
  occurred_at: string;
};

type CallPayload = CallEventPayload & {
  status?: string;
  durationSec?: number;
};

const bridgeLogger = logger.child({ module: "blueVoiceBridge" });
const MAX_ATTEMPTS = 3;

export function canonicalVoiceEvent(
  eventType: VoiceEventType,
  payload: CallPayload
): InternalVoiceEvent | null {
  const callId = payload.callId;
  if (!Number.isSafeInteger(callId) || !callId || callId <= 0) return null;
  if (!Number.isSafeInteger(payload.sessionId) || payload.sessionId <= 0) return null;
  if (!Number.isFinite(payload.timestamp)) return null;

  const normalizedPhone = String(payload.from || "").replace(/\D/g, "");
  const phone = normalizedPhone.length >= 10 && normalizedPhone.length <= 15
    ? normalizedPhone : null;
  const duration = payload.durationSec;
  const durationSeconds =
    typeof duration === "number" && Number.isInteger(duration)
      && duration >= 0 && duration <= 86400 ? duration : null;
  const providerCallId = `pabx:${payload.sessionId}:${callId}`;
  const eventId = `pabx:${payload.sessionId}:${callId}:${eventType}`;
  return {
    schema_version: "1.0",
    provider: "wavoip",
    event_id: eventId,
    provider_call_id: providerCallId,
    event_type: eventType,
    direction: payload.direction,
    phone_number: phone,
    duration_seconds: durationSeconds,
    recording_status: eventType === "voice.recording.ready" ? "ready" : "none",
    occurred_at: new Date(payload.timestamp).toISOString(),
  };
}

export function startInternalVoiceBridge(): void {
  // Default OFF: never send customer data until the internal n8n intake is
  // explicitly configured and a canary has passed.
  if (!config.BLUE_VOICE_EVENTS_ENABLED) {
    bridgeLogger.info("Internal voice n8n bridge disabled");
    return;
  }

  const endpoint = config.BLUE_VOICE_EVENTS_URL;
  const token = config.BLUE_VOICE_EVENTS_TOKEN;
  if (!endpoint || !token || token.length < 24) {
    throw new Error("Blue Voice bridge requires URL and a dedicated token");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.hostname !== "conector.conexaoazul.com"
      || !url.pathname.startsWith("/webhook/")) {
    throw new Error("Blue Voice n8n URL must use approved HTTPS webhook host");
  }

  async function send(eventType: VoiceEventType, payload: CallPayload) {
    const event = canonicalVoiceEvent(eventType, payload);
    if (!event) {
      bridgeLogger.warn({ eventType }, "Voice event missing canonical call identity");
      return;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await axios.post(endpoint!, event, {
          timeout: 5000,
          maxRedirects: 0,
          headers: {
            "Content-Type": "application/json",
            "X-Blue-Voice-Token": token!,
          },
        });
        bridgeLogger.info({ eventType, attempt }, "Internal voice event delivered");
        return;
      } catch {
        // Do not log secrets, phone numbers, media URLs, HTTP headers or body.
        bridgeLogger.warn(
          { eventType, attempt },
          "Internal voice event delivery attempt failed"
        );
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
        }
      }
    }
    bridgeLogger.error({ eventType }, "Voice event not delivered; reconciliation required");
  }

  // Only events with a persisted call ID are bridged. No dialing or external
  // WhatsApp sends are performed here.
  eventBus.on("call.persisted", (payload) => {
    void send("voice.call.created", payload);
  });
  eventBus.on("call.completed", (payload) => {
    const type: VoiceEventType = payload.status === "missed"
      ? "voice.call.missed"
      : payload.status === "rejected"
        ? "voice.call.failed" : "voice.call.completed";
    void send(type, payload);
  });
  eventBus.on("call.recording.uploaded", (payload) => {
    void send("voice.recording.ready", payload);
  });
  bridgeLogger.info("Internal voice n8n bridge enabled");
}
