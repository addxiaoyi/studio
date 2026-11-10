// @vitest-environment node
import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {mediaFileHash,MEDIA_HASH_CHUNK_BYTES} from "@/lib/media-file-hash";

it("hashes large media in bounded slices and matches native SHA-256",async()=>{
  const bytes=Buffer.alloc(65*1024*1024+7,0x5a),file=new Blob([bytes]);
  const whole=vi.spyOn(file,"arrayBuffer");
  const sliced=vi.spyOn(file,"slice");
  expect(await mediaFileHash(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(whole).not.toHaveBeenCalled();
  expect(sliced.mock.calls.every(([start,end])=>end!-start!<=MEDIA_HASH_CHUNK_BYTES)).toBe(true);
  expect(sliced).toHaveBeenCalledTimes(66);
});
it("stops canceled hashing before reading another slice",async()=>{
  const controller=new AbortController(),file=new Blob([new Uint8Array(MEDIA_HASH_CHUNK_BYTES*3)]);
  const read=file.slice.bind(file);
  const sliced=vi.spyOn(file,"slice").mockImplementation((start,end)=>{controller.abort(new Error("Canceled"));return read(start,end);});
  await expect(mediaFileHash(file,controller.signal)).rejects.toThrow("Canceled");
  expect(sliced).toHaveBeenCalledTimes(1);
});
