// Load .env BEFORE any other module is imported.
import "dotenv/config";
import app from "./app.js";
import { connectDatabase } from "./config/db.js";
import { bootstrap } from "./services/bootstrap.service.js";
import { getLlmStatus } from "./services/llm.service.js";

const PORT = process.env.PORT || 5000;

try {
  await connectDatabase();
  await bootstrap();
} catch (error) {
  console.error(`\n[Startup] ${error.message}`);
  console.error("Check that MongoDB is running and MONGO_URI in .env is correct.\n");
  process.exit(1);
}

app.listen(PORT, () => {
  const llm = getLlmStatus();
  console.log(`FinRisk Backend running on http://localhost:${PORT}`);
  console.log(
    llm.configured
      ? `LLM: ${llm.provider} (${llm.models.join(", ")}), fallback ${llm.fallback_enabled ? "on" : "off"}`
      : "LLM: not configured -> agents use the rule-based fallback. Put GEMINI_API_KEY in finrisk-backend/.env"
  );
});
