import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import signalsRouter from "./signals.js";
import settingsRouter from "./settings.js";
import whatsappRouter from "./whatsapp.js";
import subscribersRouter from "./subscribers.js";
import statusRouter from "./status.js";
import analysisInspectRouter from "./analysis-inspect.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(signalsRouter);
router.use(settingsRouter);
router.use(whatsappRouter);
router.use(subscribersRouter);
router.use(statusRouter);
router.use(analysisInspectRouter);

export default router;
