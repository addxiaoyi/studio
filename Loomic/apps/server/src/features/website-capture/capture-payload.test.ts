import { describe, expect, it } from "vitest";

import { decodeJpegPayload } from "./capture-payload.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);

describe("desktop capture payload", () => {
  it("decodes raw Base64 and JPEG data URLs", () => {
    expect(decodeJpegPayload(jpeg.toString("base64"))).toEqual(jpeg);
    expect(decodeJpegPayload(`data:image/jpeg;base64,${jpeg.toString("base64")}`)).toEqual(jpeg);
  });

  it("rejects malformed, non-JPEG, and oversized images", () => {
    expect(() => decodeJpegPayload("%%%")).toThrow("Base64");
    expect(() => decodeJpegPayload(Buffer.from("PNG").toString("base64"))).toThrow("JPEG");
    expect(() => decodeJpegPayload(jpeg.toString("base64"), 4)).toThrow("大小限制");
  });
});
