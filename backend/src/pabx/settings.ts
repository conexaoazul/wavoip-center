/**
 * Settings store - sobrescreve env via banco (tabela Setting).
 *
 * Cada chave tem um valor default vindo do `config` (env vars do .env),
 * que pode ser sobrescrito pela tabela Setting. Cache em memoria com
 * invalidacao manual ao chamar setSetting/resetSetting.
 *
 * Apenas as chaves DEFINIDAS abaixo sao expostas - infra (PORT, HOST, DB) NAO.
 */

import { prisma } from "../db/client";
import { config } from "../config";
import { logger } from "../utils/logger";

const settingsLogger = logger.child({ module: "settings" });

type SettingValue = string | number | boolean;

interface SettingDef<T extends SettingValue> {
  key: string;
  type: "string" | "number" | "boolean";
  default: T;
  description: string;
  envVar?: string;
  /** Quando true: o GET /settings nao retorna o valor cru - retorna mascarado. Usado pra API keys */
  secret?: boolean;
  /** Lista de valores permitidos - frontend renderiza dropdown */
  enum?: readonly string[];
  /** Quando true + enum: frontend usa datalist (autocomplete com valor livre) */
  enumOpen?: boolean;
}

export const SETTING_DEFS = {
  reject_calls_default: {
    key: "reject_calls_default",
    type: "boolean",
    default: config.REJECT_CALLS_DEFAULT,
    envVar: "REJECT_CALLS_DEFAULT",
    description: "Rejeitar automaticamente chamadas em sessoes novas (default)",
  } satisfies SettingDef<boolean>,
  call_reject_message_pt: {
    key: "call_reject_message_pt",
    type: "string",
    default: config.CALL_REJECT_MESSAGE_PT,
    envVar: "CALL_REJECT_MESSAGE_PT",
    description: "Mensagem enviada ao rejeitar chamada (pt-BR)",
  } satisfies SettingDef<string>,
  call_reject_message_en: {
    key: "call_reject_message_en",
    type: "string",
    default: config.CALL_REJECT_MESSAGE_EN,
    envVar: "CALL_REJECT_MESSAGE_EN",
    description: "Mensagem enviada ao rejeitar chamada (en-US)",
  } satisfies SettingDef<string>,
  ivr_timeout_seconds: {
    key: "ivr_timeout_seconds",
    type: "number",
    default: config.IVR_TIMEOUT_SECONDS,
    envVar: "IVR_TIMEOUT_SECONDS",
    description: "Timeout do IVR aguardando resposta do usuario (segundos)",
  } satisfies SettingDef<number>,
  default_locale: {
    key: "default_locale",
    type: "string",
    default: config.DEFAULT_LOCALE,
    envVar: "DEFAULT_LOCALE",
    description: "Idioma padrao para novas sessoes",
    enum: ["pt-BR", "en-US"],
  } satisfies SettingDef<string>,
  wavoip_poll_interval_ms: {
    key: "wavoip_poll_interval_ms",
    type: "number",
    default: config.WAVOIP_POLL_INTERVAL_MS,
    envVar: "WAVOIP_POLL_INTERVAL_MS",
    description: "Intervalo de polling da API Wavoip (ms)",
  } satisfies SettingDef<number>,
  agent_status: {
    key: "agent_status",
    type: "string",
    default: "available",
    description: "Status atual do agente: available | busy | paused",
  } satisfies SettingDef<string>,
  agent_busy_message: {
    key: "agent_busy_message",
    type: "string",
    default:
      "Estamos ocupados no momento. Por favor envie sua mensagem em texto que retornaremos em seguida.",
    description: "Mensagem enviada quando agente esta com status 'busy'",
  } satisfies SettingDef<string>,
  agent_paused_message: {
    key: "agent_paused_message",
    type: "string",
    default:
      "Estamos em pausa. Em instantes retornaremos. Por favor envie sua mensagem.",
    description: "Mensagem enviada quando agente esta com status 'paused'",
  } satisfies SettingDef<string>,
  outside_hours_message: {
    key: "outside_hours_message",
    type: "string",
    default:
      "Estamos fora do horario de atendimento. Nossa equipe retornara assim que possivel.",
    description: "Mensagem enviada fora do horario comercial",
  } satisfies SettingDef<string>,
  outside_hours_reject: {
    key: "outside_hours_reject",
    type: "boolean",
    default: true,
    description: "Recusar chamada quando fora do horario comercial",
  } satisfies SettingDef<boolean>,
  agent_busy_reject: {
    key: "agent_busy_reject",
    type: "boolean",
    default: true,
    description: "Recusar chamada quando agente esta busy/paused",
  } satisfies SettingDef<boolean>,
  on_accept_audio_url: {
    key: "on_accept_audio_url",
    type: "string",
    default: "",
    description:
      "URL de audio reproduzido ao atender a chamada (mixado com voz do agente). Vazio = sem URA.",
  } satisfies SettingDef<string>,
  nps_enabled: {
    key: "nps_enabled",
    type: "boolean",
    default: false,
    description: "Habilita pesquisa NPS automatica apos chamada completada",
  } satisfies SettingDef<boolean>,
  nps_delay_seconds: {
    key: "nps_delay_seconds",
    type: "number",
    default: 600,
    description: "Delay em segundos antes de enviar a pesquisa NPS",
  } satisfies SettingDef<number>,
  nps_message: {
    key: "nps_message",
    type: "string",
    default:
      "Obrigado pela ligacao! Numa escala de 0 a 10, quanto voce indicaria nosso atendimento? Responda apenas o numero.",
    description: "Mensagem da pesquisa NPS",
  } satisfies SettingDef<string>,
  nps_supervisor_phone: {
    key: "nps_supervisor_phone",
    type: "string",
    default: "",
    description: "Numero (E.164) que recebe alertas de detractor (NPS 0-6)",
  } satisfies SettingDef<string>,
  nps_min_duration_seconds: {
    key: "nps_min_duration_seconds",
    type: "number",
    default: 30,
    description: "Duracao minima (s) para disparar pesquisa NPS (0 = qualquer chamada)",
  } satisfies SettingDef<number>,
  ai_summary_min_duration_seconds: {
    key: "ai_summary_min_duration_seconds",
    type: "number",
    default: 30,
    description: "Duracao minima (s) para gerar resumo IA (0 = qualquer chamada)",
  } satisfies SettingDef<number>,
  missed_followup_enabled: {
    key: "missed_followup_enabled",
    type: "boolean",
    default: false,
    description: "Envia WhatsApp automatico apos chamada perdida/recusada",
  } satisfies SettingDef<boolean>,
  missed_followup_delay_seconds: {
    key: "missed_followup_delay_seconds",
    type: "number",
    default: 30,
    description: "Delay em segundos para enviar o followup de chamada perdida",
  } satisfies SettingDef<number>,
  missed_followup_message: {
    key: "missed_followup_message",
    type: "string",
    default:
      "Ola! Vi sua tentativa de ligacao aqui. Posso te ajudar por aqui agora?",
    description: "Mensagem enviada apos chamada perdida",
  } satisfies SettingDef<string>,
  ai_summary_enabled: {
    key: "ai_summary_enabled",
    type: "boolean",
    default: false,
    description: "Gera resumo IA pos-chamada (Whisper + Claude). Requer OPENAI_API_KEY e ANTHROPIC_API_KEY",
  } satisfies SettingDef<boolean>,
  ai_summary_send_to_client: {
    key: "ai_summary_send_to_client",
    type: "boolean",
    default: false,
    description: "Envia o resumo IA para o cliente via WhatsApp apos gerar",
  } satisfies SettingDef<boolean>,
  openai_api_key: {
    key: "openai_api_key",
    type: "string",
    default: "",
    envVar: "OPENAI_API_KEY",
    description: "API key OpenAI (Whisper transcricao). Sobrescreve .env",
    secret: true,
  } satisfies SettingDef<string>,
  openai_whisper_model: {
    key: "openai_whisper_model",
    type: "string",
    default: "gpt-4o-mini-transcribe",
    envVar: "OPENAI_WHISPER_MODEL",
    description: "Modelo OpenAI de transcricao",
    enum: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
    enumOpen: true,
  } satisfies SettingDef<string>,
  anthropic_api_key: {
    key: "anthropic_api_key",
    type: "string",
    default: "",
    envVar: "ANTHROPIC_API_KEY",
    description: "API key Anthropic (Claude para resumir transcricao). Sobrescreve .env",
    secret: true,
  } satisfies SettingDef<string>,
  anthropic_model: {
    key: "anthropic_model",
    type: "string",
    default: "claude-haiku-4-5",
    envVar: "ANTHROPIC_MODEL",
    description: "Modelo Claude para sumarizacao",
    enum: [
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ],
    enumOpen: true,
  } satisfies SettingDef<string>,
  ai_summary_provider: {
    key: "ai_summary_provider",
    type: "string",
    default: "auto",
    description:
      "Provider para sumarizacao. Auto = anthropic se houver key, senao openai. (Transcricao usa OpenAI Whisper sempre.)",
    enum: ["auto", "openai", "anthropic"],
  } satisfies SettingDef<string>,
  openai_summary_model: {
    key: "openai_summary_model",
    type: "string",
    default: "gpt-4o-mini",
    description: "Modelo OpenAI para sumarizacao quando provider=openai",
    enum: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
    enumOpen: true,
  } satisfies SettingDef<string>,
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;

const cache = new Map<string, SettingValue>();
let cacheLoaded = false;

async function loadCache(): Promise<void> {
  const rows = await prisma.setting.findMany();
  cache.clear();
  for (const r of rows) {
    const def = SETTING_DEFS[r.key as SettingKey];
    if (!def) continue;
    cache.set(r.key, deserialize(r.value, def.type));
  }
  cacheLoaded = true;
}

function serialize(value: SettingValue): string {
  return String(value);
}

function deserialize(raw: string, type: SettingDef<any>["type"]): SettingValue {
  if (type === "boolean") return raw === "true" || raw === "1";
  if (type === "number") return Number(raw);
  return raw;
}

export async function ensureCacheLoaded(): Promise<void> {
  if (!cacheLoaded) await loadCache();
}

export async function getSetting<K extends SettingKey>(
  key: K
): Promise<(typeof SETTING_DEFS)[K]["default"]> {
  await ensureCacheLoaded();
  const def = SETTING_DEFS[key];
  const cached = cache.get(key);
  return (cached ?? def.default) as (typeof SETTING_DEFS)[K]["default"];
}

export function getSettingSync<K extends SettingKey>(
  key: K
): (typeof SETTING_DEFS)[K]["default"] {
  const def = SETTING_DEFS[key];
  const cached = cache.get(key);
  return (cached ?? def.default) as (typeof SETTING_DEFS)[K]["default"];
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue
): Promise<void> {
  const def = SETTING_DEFS[key];
  if (!def) throw new Error(`Unknown setting: ${key}`);

  let parsed: SettingValue = value;
  if (def.type === "boolean") {
    if (typeof value === "boolean") parsed = value;
    else if (typeof value === "number") parsed = value === 1;
    else parsed = String(value).toLowerCase() === "true";
  } else if (def.type === "number") {
    parsed = Number(value);
    if (Number.isNaN(parsed)) throw new Error(`Setting ${key} must be a number`);
  } else if (def.type === "string") {
    parsed = String(value);
  }

  await prisma.setting.upsert({
    where: { key },
    create: { key, value: serialize(parsed) },
    update: { value: serialize(parsed) },
  });
  cache.set(key, parsed);
  settingsLogger.info({ key, value: def.secret ? "[REDACTED]" : parsed }, "Setting updated");
}

export async function resetSetting(key: SettingKey): Promise<void> {
  if (!SETTING_DEFS[key]) throw new Error(`Unknown setting: ${key}`);
  await prisma.setting.delete({ where: { key } }).catch(() => undefined);
  cache.delete(key);
  settingsLogger.info({ key }, "Setting reset to default");
}

function maskSecret(raw: SettingValue): string {
  // Não exponha prefixo/sufixo de tokens nem permita inferência por tamanho.
  return String(raw) ? "********" : "";
}

export async function listSettings(): Promise<
  Array<{
    key: string;
    type: string;
    description: string;
    envVar?: string;
    default: SettingValue;
    value: SettingValue;
    overridden: boolean;
    secret?: boolean;
    valueMasked?: string;
    enum?: readonly string[];
  }>
> {
  await ensureCacheLoaded();
  return (Object.values(SETTING_DEFS) as SettingDef<any>[]).map((def) => {
    const stored = cache.get(def.key);
    const realValue = stored ?? def.default;
    const isSecret = !!def.secret;
    return {
      key: def.key,
      type: def.type,
      description: def.description,
      envVar: def.envVar,
      default: isSecret ? (def.default ? "********" : "") : def.default,
      value: isSecret ? maskSecret(realValue) : realValue,
      overridden: stored !== undefined,
      secret: isSecret,
      enum: def.enum,
      enumOpen: def.enumOpen,
      ...(isSecret && stored ? { valueMasked: maskSecret(realValue) } : {}),
    };
  });
}
