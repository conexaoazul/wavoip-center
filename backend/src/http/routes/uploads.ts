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
import { resolveRecordingCall } from "./recordingIdentity";

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

    // Consume the multipart file before reading fields so metadata is available
    // regardless of whether the client sends file first or last.
    // The 25MB plugin limit still applies; invalid uploads are never persisted.
    const buf = await data.toBuffer();
    if (!buf.length) throw new AppError("Gravação vazia", 422);

    const { prisma } = await import("../../db/client");
    const { eventBus } = await import("../../pabx/eventBus");
    const { httpLogger } = await import("../../utils/logger");

    const call = await resolveRecordingCall(
      data.fields as Record<string, { value?: unknown }>,
      {
        byId: (id) => prisma.call.findUnique({ where: { id } }),
        byWhatsappCallId: (id) =>
          prisma.call.findUnique({ where: { whatsappCallId: id } }),
      }
    );
    if (!call) {
      // Do not store unassociated audio, return its URL, or guess the last call.
      httpLogger.warn("Recording rejected: no exact persisted call match");
      throw new AppError("Referência de chamada ausente ou divergente", 422);
    }

    const recDir = path.join(UPLOAD_DIR, "recordings");
    await fs.mkdir(recDir, { recursive: true, mode: 0o700 });
    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(data.filename || "").slice(0, 8) || ".webm";
    const filename = `rec-${id}${ext}`;
    const dest = path.join(recDir, filename);
    const url = publicUrl(`recordings/${filename}`);
    await fs.writeFile(dest, buf, { flag: "wx", mode: 0o600 });

    try {
      await prisma.callSummary.upsert({
        where: { callId: call.id },
        create: { callId: call.id, recordingUrl: url },
        update: { recordingUrl: url },
      });

    } catch (error) {
      // A DB failure must not leave an orphaned recording on disk.
      await fs.unlink(dest).catch(() => undefined);
      throw error;
    }

    httpLogger.info(
      { callId: call.id, size: buf.length },
      "Recording linked to exact call - dispatching summary"
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
