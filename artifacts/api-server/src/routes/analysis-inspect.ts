import { Router } from "express";
import { getMarketAnalysisSnapshot } from "../lib/analysis.js";

const router = Router();

router.get("/analysis-inspect", (_req, res) => {
  try {
    const snapshot = getMarketAnalysisSnapshot();
    res.json({ ok: true, markets: snapshot, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
