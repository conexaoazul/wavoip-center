import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { requiresSensitivePabxAuth, checkSensitivePabxToken } from "./sensitiveAccess";
import { httpLogger as logger } from "../utils/logger";
import { healthRoutes } from "./routes/health";
import { sessionRoutes } from "./routes/sessions";
import { callRoutes } from "./routes/calls";
import { flowRoutes } from "./routes/flows";
import { wavoipRoutes } from "./routes/wavoip";
import { settingsRoutes } from "./routes/settings";
import { businessHoursRoutes } from "./routes/businessHours";
import { callbacksRoutes } from "./routes/callbacks";
import { uploadsRoutes } from "./routes/uploads";
import { metricsRoutes } from "./routes/metrics";
import { routingRoutes } from "./routes/routing";
import { ratingsRoutes } from "./routes/ratings";
import { timelineRoutes } from "./routes/timeline";
import { summariesRoutes } from "./routes/summaries";
import { AppError } from "../utils/errors";
import { ZodError } from "zod";

export async function buildHttpServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // usamos pino direto
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN.split(","),
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  });

  // P0: prevent direct host-port access to raw call recordings and transcripts.
  // Browser/audio consumers need a reviewed authenticated proxy before rollout.
  // Without a vault-managed 32+ char key these routes fail closed.
  app.addHook("onRequest", async (req, reply) => {
    if (requiresSensitivePabxAuth(req.method, req.url)
        && !checkSensitivePabxToken(config.PABX_SENSITIVE_API_TOKEN,
            req.headers["x-pabx-internal-token"])) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  });
  const uploadDir = path.resolve(process.cwd(), ".uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: "/media/",
    decorateReply: false,
    setHeaders: (res) => {
      // CORS pra <audio crossOrigin="anonymous"> conseguir conectar no
      // AudioContext do frontend (Web Audio API exige CORS no recurso).
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof ZodError) {
      reply.code(422).send({ error: "VALIDATION_ERROR", details: err.flatten() });
      return;
    }
    logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
    const message = err instanceof Error ? err.message : String(err);
    reply.code(500).send({ error: "INTERNAL_ERROR", message });
  });

  app.addHook("onRequest", (req, _reply, done) => {
    logger.debug({ method: req.method, url: req.url }, "request");
    done();
  });

  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(callRoutes);
  await app.register(flowRoutes);
  await app.register(wavoipRoutes);
  await app.register(settingsRoutes);
  await app.register(businessHoursRoutes);
  await app.register(callbacksRoutes);
  await app.register(uploadsRoutes);
  await app.register(metricsRoutes);
  await app.register(routingRoutes);
  await app.register(ratingsRoutes);
  await app.register(timelineRoutes);
  await app.register(summariesRoutes);

  return app;
}
