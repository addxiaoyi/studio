import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fillPageField, isCredentialAction, websiteActionReceipt } from "../src/action-safety.js";

function buildSafetyContext() {
  class Input {
    constructor({ type = "text", name = "", id = "", attrs = {} } = {}) {
      this.type = type;
      this.name = name;
      this.id = id;
      this.value = "";
      this.attrs = attrs;
      this.events = [];
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  class TextArea extends Input {}
  class Select extends Input {}
  class FakeEvent { constructor(type) { this.type = type; } }
  return {
    HTMLInputElement: Input,
    HTMLTextAreaElement: TextArea,
    HTMLSelectElement: Select,
    Event: FakeEvent,
    document: { querySelector: () => null },
  };
}

describe("local website action safety", () => {
  it("recognizes credential field hints despite spelling variations", () => {
    for (const fieldType of ["password", "one_time_code", "OTP", "verification code", "MFA"]) {
      assert.equal(isCredentialAction({ fieldType }), true, fieldType);
    }
    assert.equal(isCredentialAction({ fieldType: "text" }), false);
  });

  it("refuses actual password and OTP DOM fields even when the agent labels them as text", () => {
    const context = buildSafetyContext();
    const { HTMLInputElement: Input } = context;
    const password = new Input({ type: "password" });
    context.document.querySelector = () => password;
    assert.equal(fillPageField({ selector: "#field", value: "secret" }, context).ok, false);
    assert.equal(password.value, "");

    const otp = new Input({ attrs: { autocomplete: "one-time-code" } });
    context.document.querySelector = () => otp;
    assert.equal(fillPageField({ selector: "#field", value: "123456" }, context).ok, false);
    assert.equal(otp.value, "");
  });

  it("fills ordinary text controls and returns no entered value", () => {
    const context = buildSafetyContext();
    const text = new context.HTMLInputElement({ type: "text", name: "display_name" });
    context.document.querySelector = () => text;

    const result = fillPageField({ selector: "#field", value: "Ada" }, context);

    assert.deepEqual({ ...result }, { ok: true });
    assert.equal(text.value, "Ada");
    assert.deepEqual(text.events, ["input", "change"]);
  });

  it("omits entered values from action result receipts", () => {
    assert.deepEqual(websiteActionReceipt({ kind: "fill", target: "#name", value: "private text" }), {
      kind: "fill",
      target: "#name",
    });
  });
});
