import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.routes.js";
import documentRoutes from "./routes/document.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import knowledgeRoutes from "./routes/knowledge.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { getLlmStatus } from "./services/llm.service.js";
import { databaseStatus } from "./config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (req, res) => {
  const llm = getLlmStatus();
  res.json({
    success: true,
    service: "FinRisk Backend",
    status: "healthy",
    database: databaseStatus(),
    llm: { provider: llm.provider, configured: llm.configured, fallback_enabled: llm.fallback_enabled }
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);   // Document Agent, Analysis, Risk Advisor, Reports
app.use("/api/chat", chatRoutes);             // Ask FinRisk
app.use("/api/knowledge", knowledgeRoutes);   // Global + company knowledge (RAG)
app.use("/api/admin", adminRoutes);           // Users, companies, system

app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Serve the built React app (after `npm run build` in finrisk-frontend).
const frontendDist = path.join(__dirname, "..", "..", "finrisk-frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

// Errors -> JSON
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Request body is not valid JSON" });
  }
  if (error.name === "ValidationError") {
    return res.status(400).json({ success: false, message: Object.values(error.errors).map((e) => e.message).join("; ") });
  }
  const status = error.status && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error("[Server] unhandled error:", error);
  res.status(status).json({ success: false, message: status >= 500 ? "Internal server error" : error.message });
});

export default app;
