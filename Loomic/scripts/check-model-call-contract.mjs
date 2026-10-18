import fs from "node:fs";

const path = "docs/tech/model-call-reliability.md";
const required = [
  "publicly readable",
  "business rejection",
  "Canvas autosave preserves server-created video elements",
  "approval confirmation is idempotent",
  "configuration_only",
  "Retired or unsupported model IDs are rejected",
  "invalid_provider_response",
  "tool.completed.output.errorCode",
  "invalid_input",
];
const text = fs.readFileSync(path, "utf8");
const missing = required.filter((phrase) => !text.includes(phrase));
if (missing.length) throw new Error("Model-call reliability contract missing: " + missing.join(", "));
console.log("MODEL_CALL_CONTRACT_OK " + path);
