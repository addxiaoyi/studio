import { ChatOpenAI } from "@langchain/openai";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_API_BASE;
if (!apiKey || !baseURL) throw new Error("OpenAI compatibility env is missing");

const streamingModel = new ChatOpenAI({
  model: "hy3",
  apiKey,
  configuration: { baseURL },
  streaming: true,
  streamUsage: false,
});

const directModel = new ChatOpenAI({
  model: "hy3",
  apiKey,
  configuration: { baseURL },
  streaming: false,
  timeout: 20_000,
});
const direct = await directModel.invoke("Reply with OK only.");
console.log("MODEL_INVOKE_OK", JSON.stringify({ content: direct.content }));

let text = "";
for await (const chunk of await streamingModel.stream("Reply with OK only.")) {
  if (typeof chunk.content === "string") text += chunk.content;
}
console.log("MODEL_PROBE_OK", JSON.stringify({ text }));
