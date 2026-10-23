/**
 * Rotas /uploads - upload de arquivos de media (audio/imagem) usados pelo
 * welcome sequence e outras automacoes.
 *
 * Arquivos sao gravados em ./.uploads/<uuid>-<original-name> e servidos
 * estaticamente via @fastify/static em /media/<arquivo>.
 *
 *  POST /uploads        multipart/form-data, campo "file"
 *                       -> { url, filename, mimetype, size }
 *  GET  /uploads        lista arquivos
 *  DELETE /uploads/:name
 */

import type { FastifyInstance } from "fastify";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { AppError } from "../../utils/errors";
import { config } from "../../config";

const UPLOAD_DIR = path.resolve(process.cwd(), ".uploads");

async function ensureDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

function publicUrl(filename: string): string {
  // URL absoluto pra que o Baileys consiga fetchar.
  // IMPORTANTE: encodaURIComponent quebra paths com "/", entao tratamos
  // segmento por segmento (path "recordings/rec-x.webm" -> "recordings/rec-x.webm")
  const base = `http://${config.HOST === "0.0.0.0" ? "localhost" : config.HOST}:${config.PORT}`;
  const encoded = filename
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${base}/media/${encoded}`;
}

export async function uploadsRoutes(app: FastifyInstance) {
  app.post("/uploads", async (req) => {
    const data = await (req as any).file();
    if (!data) {
      throw new AppError("Nenhum arquivo enviado", 400);
    }
    await ensureDir();
    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(data.filename).slice(0, 8) || "";
    const safeBase = path
      .basename(data.filename, ext)
      .replace(/[^a-zA-Z0-9-_]/g, "_")
      .slice(0, 60);
    const filename = `${id}-${safeBase}${ext}`;
    const dest = path.join(UPLOAD_DIR, filename);

    const buf = await data.toBuffer();
    await fs.writeFile(dest, buf);

    return {
      url: publicUrl(filename),
      filename,
      mimetype: data.mimetype,
      size: buf.length,
    };
  });

  app.get("/uploads", async () => {
    await ensureDir();
    const files = await fs.readdir(UPLOAD_DIR);
    const items = await Promise.all(
      files.map(async (f) => {
        const stat = await fs.stat(path.join(UPLOAD_DIR, f));
        return {
          url: publicUrl(f),
          filename: f,
          size: stat.size,
          createdAt: stat.birthtime.toISOString(),
        };
      })
    );
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items, count: items.length };
  });

  app.delete("/uploads/:name", async (req) => {
    const name = (req.params as any).name as string;
    const safe = path.basename(name);
    const target = path.join(UPLOAD_DIR, safe);
    if (!target.startsWith(UPLOAD_DIR)) {
      throw new AppError("Path traversal denied", 400);
    }
    await fs.unlink(target).catch(() => undefined);
    return { ok: true };
  });

  // Upload de gravacao de chamada (mp3/webm/ogg).
  app.post("/calls/recording", async (req) => {
    const data = await (req as any).file();
    if (!data) throw new AppError("Nenhum arquivo enviado", 400);

    let whatsappCallId: string | undefined;
    let callIdParam: number | undefined;
    try {
      const fields: any = data.fields ?? {};
      whatsappCallId = fields?.whatsappCallId?.value;
      const cid = fields?.callId?.value;
      if (cid) {
        const parsedCallId = Number(cid);
        if (Number.isSafeInteger(parsedCallId) && parsedCallId > 0) {
          callIdParam = parsedCallId;
        }
      }
    } catch {}

    await ensureDir();
    const recDir = path.join(UPLOAD_DIR, "recordings");
    await fs.mkdir(recDir, { recursive: true });

    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(data.filename || "").slice(0, 8) || ".webm";
    const filename = `rec-${id}${ext}`;
    const dest = path.join(recDir, filename);
    const buf = await data.toBuffer();
    await fs.writeFile(dest, buf);

    const url = publicUrl(`recordings/${filename}`);

    const { prisma } = await import("../../db/client");
    const { eventBus } = await import("../../pabx/eventBus");
    const { httpLogger } = await import("../../utils/logger");

    httpLogger.info(
      { whatsappCallId, callIdParam, size: buf.length, filename },
      "Recording uploaded"
    );

    // Somente um ID exato e confiável pode vincular gravação a uma chamada.
    // Nunca atribuir a gravação à chamada mais recente: isso mistura contatos
    // e pode acionar transcrição/CRM da pessoa errada.
    let call: any = null;
    if (callIdParam) {
      call = await prisma.call.findUnique({ where: { id: callIdParam } });
      if (call && whatsappCallId && call.whatsappCallId !== whatsappCallId) {
        httpLogger.warn(
          { callIdParam, whatsappCallId },
          "Recording: callId e whatsappCallId divergentes; vínculo recusado"
        );
        call = null;
      }
    } else if (whatsappCallId) {
      call = await prisma.call.findUnique({ where: { whatsappCallId } });
    }

    if (!call) {
      httpLogger.warn({ whatsappCallId }, "Recording sem identificador exato ou sem call match");
      return { ok: true, url, callId: null, note: "no call match" };
    }

    await prisma.callSummary.upsert({
      where: { callId: call.id },
      create: { callId: call.id, recordingUrl: url },
      update: { recordingUrl: url },
    });

    httpLogger.info(
      { callId: call.id, url },
      "CallSummary atualizado com recordingUrl - disparando aiSummary"
    );

    // Evento DEDICADO pra recording uploaded - so o aiSummary escuta
    // (NPS/followup nao re-disparam).
    eventBus.emit("call.recording.uploaded" as any, {
      callId: call.id,
      sessionId: call.sessionId,
      from: call.fromNumber,
      direction: call.direction,
      durationSec: call.durationSec ?? 60,
      status: call.status,
      timestamp: Date.now(),
      _recordingAvailable: true,
    });

    return { ok: true, url, callId: call.id, size: buf.length };
  });
}
