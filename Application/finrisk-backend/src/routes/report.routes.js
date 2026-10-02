import express from "express";
import {
  analyzeReport,
  listAllReports,
  getOneReport,
  downloadPdf
} from "../controllers/report.controller.js";

const router = express.Router();

router.get("/", listAllReports);
router.get("/:id", getOneReport);
router.post("/:id/analyze", analyzeReport);
router.get("/:id/pdf", downloadPdf);

export default router;
