import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import documentRoutes from "./routes/document.routes.js";
import reportRoutes from "./routes/report.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import { getLlmStatus } from "./services/llm.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "FinRisk Backend",
    status: "healthy",
    llm: getLlmStatus() // provider + model only, never the key
  });
});

app.use("/api/documents", documentRoutes);   // Document Processing Agent
app.use("/api/reports", reportRoutes);        // Analysis, Risk Advisor, Report Generator
app.use("/api/chat", chatRoutes);             // Risk Advisor Chatbot

// Unknown API routes -> JSON 404
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Optional: serve the built React app (after `npm run build` in finrisk-frontend)
// so the whole system runs from one port for the demo.
const frontendDist = path.join(__dirname, "..", "..", "finrisk-frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(frontendDist, "index.html")));
} else {
  app.get("/", (req, res) => {
    res.json({ success: true, message: "FinRisk Backend API is running" });
  });
}

// Malformed JSON bodies and other errors -> JSON instead of an HTML page
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Request body is not valid JSON" });
  }
  console.error("[Server] unhandled error:", error);
  res.status(500).json({ success: false, message: "Internal server error", error: error.message });
});

export default app;
