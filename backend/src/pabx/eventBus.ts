import { EventEmitter } from "events";

export type CallEventPayload = {
  sessionId: number;
  callId?: number;
  /** Durable CallEvent primary key, shared across retries/reconciliation. */
  sourceEventId?: number;
  whatsappCallId?: string;
  from: string;
  to?: string;
  direction: "incoming" | "outgoing";
  timestamp: number;
  raw?: unknown;
};

export type CallTerminatedPayload = CallEventPayload & {
  reason?: "rejected" | "missed" | "completed" | "terminated";
  durationSec?: number;
};

export type IvrInputPayload = {
  sessionId: number;
  callId: number;
  from: string;
  input: string;
  timestamp: number;
};

export type SessionStatusPayload = {
  sessionId: number;
  status: "OPENING" | "CONNECTED" | "DISCONNECTED" | "QRCODE";
  qrcode?: string;
  number?: string;
};

type Events = {
  "call.incoming": CallEventPayload;
  "call.persisted": CallEventPayload;
  "call.outgoing": CallEventPayload;
  "call.accepted": CallEventPayload;
  "call.rejected": CallTerminatedPayload;
  "call.terminated": CallTerminatedPayload;
  "call.missed": CallTerminatedPayload;
  // Emitido APOS o Call ser atualizado no banco (callId/durationSec garantidos).
  // Listeners de NPS/IA/Followup escutam este.
  "call.completed": CallTerminatedPayload & {
    callId: number;
    sessionId: number;
    durationSec?: number;
    status: string;
  };
  // Emitido pelo endpoint POST /calls/recording. Sem NPS/followup, so aiSummary.
  "call.recording.uploaded": CallTerminatedPayload & {
    callId: number;
    sessionId: number;
    durationSec?: number;
    status: string;
  };
  "ivr.input": IvrInputPayload;
  "session.status": SessionStatusPayload;
};

class TypedEventBus extends EventEmitter {
  emit<K extends keyof Events>(event: K, payload: Events[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): this {
    return super.on(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): this {
    return super.off(event, listener);
  }
}

export const eventBus = new TypedEventBus();
eventBus.setMaxListeners(100);
