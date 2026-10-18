const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const expected = new Set([
  "gpt-image-2", "gpt-image-2-1k", "gpt-image-2-2k",
  "gpt-image-2-4k", "gpt-image-2-4k-超分", "gpt-image-2.5-1k",
  "gpt-image-2.5-2k", "gpt-image-2.5-4k",
]);

const response = await fetch(`${baseUrl}/api/image-models`);
if (!response.ok) throw new Error(`image-models returned HTTP ${response.status}`);
const body = await response.json();
const models = new Set((body.models ?? []).map((model) => model.id));
const unavailable = new Set((body.unavailableModels ?? []).map((model) => model.id));
const missing = [...expected].filter((id) => !models.has(id) && !unavailable.has(id));
if (missing.length) throw new Error(`Image model catalog missing: ${missing.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  configured: [...expected].filter((id) => models.has(id)),
  unavailable: [...expected].filter((id) => unavailable.has(id)),
}, null, 2));
