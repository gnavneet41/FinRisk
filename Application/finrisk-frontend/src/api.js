// All backend calls in one place. The Vite proxy (vite.config.js)
// forwards /api to the Node backend, so no URLs or keys live here.

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Cannot reach the FinRisk backend. Check that it is running on port 5000.");
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON response (should not happen for /api routes)
  }

  if (!response.ok || body?.success === false) {
    const error = new Error(body?.message || `Request failed (${response.status})`);
    error.stage = body?.stage;
    error.detail = body?.error;
    error.report = body?.report ?? null;
    throw error;
  }
  return body;
}

export function getHealth() {
  return request("/api/health");
}

export function uploadDocument(file) {
  const form = new FormData();
  form.append("document", file);
  return request("/api/documents/upload", { method: "POST", body: form });
}

export function analyzeReport(id, corrections) {
  return request(`/api/reports/${id}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ financial_data: corrections })
  });
}

export function listReports() {
  return request("/api/reports");
}

export function getReport(id) {
  return request(`/api/reports/${id}`);
}

export function askQuestion({ question, reportId, history }) {
  return request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, report_id: reportId, history })
  });
}
