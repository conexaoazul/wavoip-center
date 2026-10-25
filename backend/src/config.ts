import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  DATABASE_URL: z.string().default("file:./dev.db"),

  SESSIONS_DIR: z.string().default("./.sessions"),
  BAILEYS_LIB: z.enum(["v7"]).default("v7"),

  WAVOIP_API_BASE_URL: z.string().url().default("https://api.wavoip.com"),
  WAVOIP_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  DEFAULT_LOCALE: z.enum(["pt-BR", "en-US"]).default("pt-BR"),
  SUPPORTED_LOCALES: z.string().default("pt-BR,en-US"),

  REJECT_CALLS_DEFAULT: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  CALL_REJECT_MESSAGE_PT: z
    .string()
    .default(
      "As chamadas de voz e video estao desabilitadas para esse WhatsApp. Por favor, envie uma mensagem de texto."
    ),
  CALL_REJECT_MESSAGE_EN: z
    .string()
    .default("Voice and video calls are disabled for this WhatsApp. Please send a text message."),

  IVR_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  CORS_ORIGIN: z.string().default("*"),
  // Internal-only sensitive media API. No token => recording/media/summary routes deny.
  // Provision via secret store, never reuse JWT_SECRET or WhatsApp provider keys.
  PABX_SENSITIVE_API_TOKEN: z.string().optional(),

  // Integração unidirecional PABX -> n8n, exclusivamente interna e OFF.
  BLUE_VOICE_EVENTS_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  BLUE_VOICE_EVENTS_URL: z.string().url().optional(),
  BLUE_VOICE_EVENTS_TOKEN: z.string().optional(),

  // === IA (Fase 7) ===
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_WHISPER_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = z.infer<typeof ConfigSchema>;

export const SUPPORTED_LOCALES = config.SUPPORTED_LOCALES.split(",").map((s) => s.trim());
