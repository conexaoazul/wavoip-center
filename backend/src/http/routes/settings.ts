/**
 * Rotas /settings - expoe e gerencia configuracoes globais que vivem
 * em DB e sobrescrevem o .env.
 *
 *  GET    /settings         -> lista completa com {key, value, default, overridden, ...}
 *  GET    /settings/:key    -> valor atual de uma chave
 *  PUT    /settings         -> batch update { key: value, ... }
 *  PUT    /settings/:key    -> update unitario { value: ... }
 *  DELETE /settings/:key    -> reset (volta ao default do .env)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SETTING_DEFS,
  listSettings,
  getSetting,
  setSetting,
  resetSetting,
  type SettingKey,
} from "../../pabx/settings";
import { NotFoundError, ValidationError } from "../../utils/errors";

const VALID_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

function assertValidKey(key: string): asserts key is SettingKey {
  if (!(VALID_KEYS as string[]).includes(key)) {
    throw new NotFoundError(`Setting "${key}"`);
  }
}

const BatchSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const SingleSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/settings", async () => {
    const items = await listSettings();
    return { items, count: items.length };
  });

  app.get("/settings/:key", async (req) => {
    const key = (req.params as any).key as string;
    assertValidKey(key);
    const value = await getSetting(key);
    const def = SETTING_DEFS[key];
    const isSecret = (def as any).secret === true;
    const masked =
      isSecret && typeof value === "string" && value.length > 8
        ? `${value.slice(0, 4)}...${value.slice(-4)}`
        : isSecret && value
          ? "********"
          : "";
    return {
      key,
      // Mascara secrets - nunca expor key crua via GET (XSS / log leakage)
      value: isSecret ? masked : value,
      type: def.type,
      default: isSecret ? (def.default ? "********" : "") : def.default,
      envVar: (def as any).envVar,
      description: def.description,
      secret: isSecret,
      enum: (def as any).enum,
      enumOpen: (def as any).enumOpen,
    };
  });

  app.put("/settings", async (req) => {
    const body = BatchSchema.parse((req as any).body);
    const updated: string[] = [];
    const failures: Array<{ key: string; error: string }> = [];

    for (const [key, value] of Object.entries(body)) {
      if (!(VALID_KEYS as string[]).includes(key)) {
        failures.push({ key, error: "unknown setting" });
        continue;
      }
      try {
        await setSetting(key as SettingKey, value as any);
        updated.push(key);
      } catch (e) {
        failures.push({ key, error: (e as Error).message });
      }
    }

    if (failures.length && updated.length === 0) {
      throw new ValidationError(
        "Nenhuma configuracao pode ser atualizada: " + failures.map((f) => `${f.key}: ${f.error}`).join("; ")
      );
    }

    return { ok: true, updated, failures };
  });

  app.put("/settings/:key", async (req) => {
    const key = (req.params as any).key as string;
    assertValidKey(key);
    const body = SingleSchema.parse((req as any).body);
    await setSetting(key, body.value as any);
    const isSecret = (SETTING_DEFS[key] as any).secret === true;
    return { ok: true, key, value: isSecret ? "********" : await getSetting(key) };
  });

  app.delete("/settings/:key", async (req) => {
    const key = (req.params as any).key as string;
    assertValidKey(key);
    await resetSetting(key);
    const isSecret = (SETTING_DEFS[key] as any).secret === true;
    return { ok: true, key, value: isSecret ? "********" : await getSetting(key), overridden: false };
  });
}
