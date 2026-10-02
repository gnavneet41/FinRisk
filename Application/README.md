# FinRisk — Multi-Agent Financial Risk Assessment System

## Folders

```
Application/
├── finrisk-backend/          Node.js + Express API (port 5000)
│   ├── src/
│   │   ├── controllers/      document, report, chat
│   │   ├── routes/
│   │   └── services/
│   │       ├── document.service.js          Document Processing Agent (PDF/DOCX extraction)
│   │       ├── validation.service.js        consistency checks
│   │       ├── analysisAgent.service.js     Financial Analysis Agent (LLM picks analyses)
│   │       ├── calculationEngine.service.js deterministic ratio formulas
│   │       ├── riskAdvisor.service.js       Risk Advisor Agent (RAG + LLM)
│   │       ├── knowledgeBase.service.js     RAG: chunking + BM25 retrieval
│   │       ├── reportGenerator.service.js   PDF report
│   │       ├── riskChatbot.service.js       Risk Advisor Chatbot
│   │       ├── llm.service.js               provider switch + retries
│   │       ├── gemini.service.js / openaiCompatible.service.js
│   │       ├── fallback.service.js          rule-based mode when no LLM
│   │       ├── pipeline.service.js          runs the stages in order
│   │       └── reportStore.service.js       saves reports/<id>.json + .pdf
│   ├── knowledge/            risk_knowledge.json + docs/*.md (RAG sources)
│   └── test/                 npm test (offline, no LLM calls)
└── finrisk-frontend/         React + Vite (port 5173 in development)
```

## Run (development)

Terminal 1:
```
cd finrisk-backend
npm install
npm test
npm run dev
```

Terminal 2:
```
cd finrisk-frontend
npm install
npm run dev
```

Open http://localhost:5173

## Run (demo, one port)

```
cd finrisk-frontend
npm run build
cd ../finrisk-backend
npm start
```

Open http://localhost:5000

## API

| Method | Path | Diagram step |
|---|---|---|
| POST | /api/documents/upload (field `document`) | Document Processing Agent |
| POST | /api/reports/:id/analyze (optional body `{ "financial_data": {...corrections} }`) | Analysis Agent, Ratio Engine, Risk Advisor, Report Generator |
| GET | /api/reports/:id/pdf | Report (PDF) |
| GET | /api/reports, /api/reports/:id | report history |
| POST | /api/chat `{ question, report_id, history }` | Risk Advisor Chatbot |
| GET | /api/health | LLM status |

`POST /api/documents/upload?analyze=true` runs everything in one request (useful with curl).
