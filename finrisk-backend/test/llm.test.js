// Tests for the LLM layer: JSON parsing and retry on bad output.
// No real LLM is called.
import assert from "assert";

process.env.LLM_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-model";

const { parseJson, generateJson } = await import("../src/services/llm.service.js");
const quiet = console.error;
console.error = () => {};

// ---------- parser ----------
assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
assert.deepEqual(parseJson('Here you go:\n{"a":{"b":"x}y"}}\nHope this helps'), { a: { b: "x}y" } });
assert.deepEqual(parseJson('{"a":[1,2,],}'), { a: [1, 2] });
assert.deepEqual(parseJson('{"a":"quote \\" and } brace"} {"second":2}'), { a: 'quote " and } brace' });
assert.throws(() => parseJson('{"risk_factors": [{"id": "RF1", "title": "cut'), /cut off/);
assert.deepEqual(parseJson('{"a":1}', "MAX_TOKENS"), { a: 1 }); // complete JSON is still accepted
assert.throws(() => parseJson(""), /empty/);
console.log("PASS parser: fences, extra text, trailing commas, braces in strings, cut-off detection");

// ---------- retry once on unusable JSON ----------
const replies = [
  { text: '{"risk_factors": [{"id": "RF1", "inter', finishReason: "MAX_TOKENS" },
  { text: '{"ok": true}', finishReason: "STOP" }
];
let calls = 0;
globalThis.fetch = async (url, opts) => {
  const r = replies[calls++];
  assert.equal(JSON.parse(opts.body).generationConfig.maxOutputTokens, 8192);
  return new Response(JSON.stringify({ candidates: [{ finishReason: r.finishReason, content: { parts: [{ text: r.text }] } }] }), { status: 200 });
};
console.warn = () => {};
const result = await generateJson("x", { label: "Test" });
assert.deepEqual(result.data, { ok: true });
assert.equal(calls, 2);
console.log("PASS retry: cut-off answer is requested again and the second answer is used");

// ---------- gives up after two bad answers ----------
calls = 0;
replies.splice(0, 2,
  { text: "not json at all", finishReason: "STOP" },
  { text: "still not json", finishReason: "STOP" });
await assert.rejects(generateJson("x", { label: "Test" }), /invalid JSON/);
assert.equal(calls, 2);
console.log("PASS give up: two unusable answers -> error (agents then use the fallback)");
console.error = quiet;
