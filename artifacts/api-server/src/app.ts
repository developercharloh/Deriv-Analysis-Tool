import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { startBot } from "./lib/bot.js";
import { registerMatchesDispatcher, startMatchesSchedule } from "./lib/scheduler.js";
import { dispatchBestSignalIfReady } from "./routes/signals.js";
import { startWhatsApp } from "./lib/whatsapp.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

async function bootstrap() {
  await startBot();
  registerMatchesDispatcher(dispatchBestSignalIfReady);
  startMatchesSchedule();
  startWhatsApp().catch((err) => logger.error({ err }, "WhatsApp startup error"));
  logger.info("MATCHES auto-dispatch schedule registered. WhatsApp client starting.");
}

bootstrap().catch((err) => logger.error({ err }, "Error starting bot"));

export default app;
