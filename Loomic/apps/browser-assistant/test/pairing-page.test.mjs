import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script = await readFile(new URL("../src/pairing-page.js", import.meta.url), "utf8");

function runPairingPage({ origin, pathname, hash, response = { connected: true } }) {
  const status = { textContent: "", dataset: {} };
  const messages = [];
  const replaced = [];
  const context = {
    location: { origin, pathname, hash },
    history: { replaceState: (...args) => replaced.push(args) },
    document: { querySelector: () => status },
    chrome: {
      runtime: {
        sendMessage: (message) => {
          messages.push(message);
          return Promise.resolve(response);
        },
      },
    },
    URLSearchParams,
  };
  vm.runInNewContext(script, context);
  return { messages, replaced, status };
}

test("sends the short-lived pairing secret to the extension and immediately clears the URL fragment", async () => {
  const { messages, replaced, status } = runPairingPage({
    origin: "https://studio.0st.top",
    pathname: "/desktop-browser-pair.html",
    hash: "#code=one-time-code&wssUrl=wss%3A%2F%2Fstudio.0st.top%2Fapi%2Fwebsite-capture%2Fassistant%2Fws",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{
    type: "assistant.connect",
    code: "one-time-code",
    wssUrl: "wss://studio.0st.top/api/website-capture/assistant/ws",
  }]);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0][2], "/desktop-browser-pair.html");
  assert.equal(status.dataset.state, "connected");
});

test("rejects pairing links from untrusted origins", () => {
  const { messages, status } = runPairingPage({
    origin: "https://evil.example",
    pathname: "/desktop-browser-pair.html",
    hash: "#code=one-time-code&wssUrl=wss%3A%2F%2Fstudio.0st.top%2Fapi%2Fwebsite-capture%2Fassistant%2Fws",
  });

  assert.equal(messages.length, 0);
  assert.equal(status.textContent, "");
});

test("reports rejected or expired pairings", async () => {
  const { messages, status } = runPairingPage({
    origin: "https://studio.0st.top",
    pathname: "/desktop-browser-pair.html",
    hash: "#code=expired-code&wssUrl=wss%3A%2F%2Fstudio.0st.top%2Fapi%2Fwebsite-capture%2Fassistant%2Fws",
    response: { connected: false, message: "Invalid or expired pairing" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(status.dataset.state, "failed");
  assert.equal(status.textContent, "Invalid or expired pairing");
});
