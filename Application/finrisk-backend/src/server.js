// Load .env BEFORE any other module is imported.
// (With ES modules, imports run before the code below them, so
//  dotenv.config() placed after the imports runs too late.)
import "dotenv/config";
import app from "./app.js";
import { getLlmStatus } from "./services/llm.service.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  const llm = getLlmStatus();
  console.log(`FinRisk Backend running on http://localhost:${PORT}`);
  console.log(
    llm.configured
      ? `LLM: ${llm.provider} (${llm.models.join(", ")}), fallback ${llm.fallback_enabled ? "on" : "off"}`
      : "LLM: not configured -> agents will use the rule-based fallback. " +
        "Put GEMINI_API_KEY in finrisk-backend/.env"
  );
});
