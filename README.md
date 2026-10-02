# FinRisk — Multi-Agent Financial Risk Assessment System

## What it does

A company user uploads a financial statement (PDF, CSV or Excel). FinRisk:

1. **Document Agent** extracts 30 financial values (no LLM).
2. **Validation** checks the statements are consistent.
3. **Analysis Agent** (LLM) decides which analyses and ratios are relevant.
4. **Calculation Engine** computes the ratios in code — the LLM never does arithmetic.
5. **Risk Advisor** (LLM + RAG) interprets the ratios using the global knowledge base and the company's private knowledge, and every claim must cite real evidence.
6. **Report Generator** creates a PDF report.
7. **Ask FinRisk** answers questions about the analysis with sources.

If the LLM is busy or not configured, every agent falls back to documented rules, so the app always works.

## Roles

| Role | Can |
|---|---|
| admin | Users (create, deactivate, reset access, assign role), companies (create, activate/deactivate, subscription), system settings (processing, LLM, RAG, monitoring), global knowledge. **Cannot** see company documents or private company knowledge. |
| analyst | Upload and analyse documents, correct extracted values, manage company knowledge, use Ask FinRisk. |
| viewer | Read-only: dashboard, analyses, reports, Ask FinRisk. |

## Knowledge base

```
                Knowledge Base
                      |
              +-------+--------+
              |                |
           GLOBAL           COMPANY (private)
        admin manages      company analysts manage
        all companies      only that company's users
```

Retrieval for a company uses global + that company's knowledge only. Completed analyses are added to the company knowledge automatically as historical reports.

## Requirements

- Node.js 18 or newer
- MongoDB Community Server running locally (or a MongoDB Atlas connection string)

## Setup (first time)

```
cd finrisk-backend
copy .env.example .env        (then edit .env: GEMINI_API_KEY, JWT_SECRET)
npm install
npm run seed
```

`npm run seed` creates the global knowledge base, a demo company, demo users and the Apple Inc. FY2024 sample analysis:

| Account | Email | Password |
|---|---|---|
| Admin | admin@finrisk.local | Admin@12345 |
| Analyst | analyst@demo.finrisk | Analyst@12345 |
| Viewer | viewer@demo.finrisk | Viewer@12345 |

Demo passwords are for local testing only.

```
cd ..\finrisk-frontend
npm install
```

## Run (development)

Terminal 1: `cd finrisk-backend` then `npm run dev`
Terminal 2: `cd finrisk-frontend` then `npm run dev`

Open http://localhost:5173

## Run (demo on one port)

```
cd finrisk-frontend
npm run build
cd ..\finrisk-backend
npm start
```

Open http://localhost:5000

## Tests

```
cd finrisk-backend
npm test
```

Needs MongoDB running. Uses a separate database `finrisk_test` (dropped each run) and temporary folders, and never calls the real LLM.

## Main API

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password` |
| Documents | `GET/POST /api/documents`, `POST /api/documents/upload`, `POST /api/documents/:id/analyze`, `GET /api/documents/:id/pdf` |
| Ask FinRisk | `POST /api/chat` |
| Knowledge | `/api/knowledge/global`, `/api/knowledge/company`, `POST /api/knowledge/search` |
| Admin | `/api/admin/users`, `/api/admin/companies`, `/api/admin/system/config/:section`, `/api/admin/system/monitoring` |
