/**
 * Wavoip PABX - entrypoint principal.
 *
 * Boot:
 *  1. Carrega configuracao + logger
 *  2. Inicia Prisma (lazy via primeiro query)
 *  3. Constroi servidor Fastify + Socket.IO
 *  4. Importa modulos PABX (registram listeners no eventBus)
 *  5. Sobe sessoes WhatsApp ativas (auto-reconexao via Baileys)
 *  6. Escuta porta
 */

import { config } from "./config";
import { logger } from "./utils/logger";
import { buildHttpServer } from "./http/server";
import { initSocket } from "./http/socket";
import { startAllActiveSessions } from "./baileys/sessionManager";
import { startWavoipPoller, stopWavoipPoller } from "./wavoip/poller";
import { initI18n } from "./utils/i18n";
import { disconnectPrisma } from "./db/client";

// Importa modulos com side effects (registram listeners no eventBus):
import "./pabx/callLogger";
import "./pabx/autoReply";
import "./pabx/ivr/engine";
import "./pabx/nps";
import "./pabx/missedFollowup";
import "./pabx/aiSummary";
import { startInternalVoiceBridge } from "./blueVoice/eventBridge";

async function main() {
  logger.info(
    {
      env: config.NODE_ENV,
      port: config.PORT,
      host: config.HOST,
      defaultLocale: config.DEFAULT_LOCALE,
    },
    "Wavoip PABX starting"
  );

  await initI18n();

  // Registers internal PABX event listeners; disabled by default.
  startInternalVoiceBridge();

  const app = await buildHttpServer();

  // Anexa Socket.IO ao http server do Fastify
  await app.ready();
  initSocket(app.server);

  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ url: `http://${config.HOST}:${config.PORT}` }, "HTTP server listening");

  // Inicia sessoes WhatsApp ativas em background
  startAllActiveSessions().catch((e) => logger.error({ err: e }, "startAllActiveSessions failed"));

  // Inicia poller Wavoip (enriquece logs com dados da API Wavoip)
  startWavoipPoller();

  const shutdown = async (signal: string) => {
    logger.warn({ signal }, "Shutting down");
    try {
      stopWavoipPoller();
      await app.close();
      await disconnectPrisma();
    } catch (e) {
      logger.error({ err: e }, "shutdown error");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
  process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException"));
}

main().catch((e) => {
  logger.error({ err: e }, "fatal boot error");
  process.exit(1);
});
