/**
 * Match recordings only against an exact persisted call.
 * Multipart field order is handled by reading fields after consuming the file.
 * This module never stores media, logs personal data, or guesses by timestamp.
 */
export type RecordingCallIdentity = { id: number; whatsappCallId: string | null };

export type RecordingCallLookup<T extends RecordingCallIdentity> = {
  byId: (id: number) => Promise<T | null>;
  byWhatsappCallId: (id: string) => Promise<T | null>;
};

export async function resolveRecordingCall<T extends RecordingCallIdentity>(
  fields: Record<string, { value?: unknown } | undefined> | undefined,
  lookup: RecordingCallLookup<T>,
): Promise<T | null> {
  const rawId = fields?.callId?.value;
  const rawWhatsappId = fields?.whatsappCallId?.value;
  const hasId = rawId !== undefined && rawId !== null && rawId !== "";
  const hasWhatsappId = rawWhatsappId !== undefined && rawWhatsappId !== null && rawWhatsappId !== "";
  if (!hasId && !hasWhatsappId) return null;

  let callId: number | undefined;
  if (hasId) {
    if (typeof rawId !== "string" && typeof rawId !== "number") return null;
    const literal = String(rawId);
    if (!/^[1-9][0-9]*$/.test(literal)) return null;
    callId = Number(literal);
    if (!Number.isSafeInteger(callId)) return null;
  }

  let whatsappCallId: string | undefined;
  if (hasWhatsappId) {
    if (typeof rawWhatsappId !== "string" || rawWhatsappId.length > 256
        || Array.from(rawWhatsappId).some(ch => ch.charCodeAt(0) <= 32)) return null;
    whatsappCallId = rawWhatsappId;
  }

  const call = callId !== undefined
    ? await lookup.byId(callId)
    : await lookup.byWhatsappCallId(whatsappCallId!);
  if (!call) return null;
  if (whatsappCallId && call.whatsappCallId !== whatsappCallId) return null;
  return call;
}
