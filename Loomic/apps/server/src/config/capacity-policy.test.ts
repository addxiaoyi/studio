import { describe, expect, it } from "vitest";
import { DEFAULT_CAPACITY_POLICY, parseCapacityPolicy } from "./capacity-policy.js";

describe("capacity policy", () => {
  it("keeps the current production reserve defaults", () => {
    expect(parseCapacityPolicy({} as NodeJS.ProcessEnv)).toEqual(
      DEFAULT_CAPACITY_POLICY,
    );
    expect(DEFAULT_CAPACITY_POLICY).toMatchObject({
      systemDiskReserveBytes: 512 * 1024 ** 2,
      storageDiskReserveBytes: 64 * 1024 ** 2,
      mediaAdmissionReserveBytes: 2 * 1024 ** 3,
      mediaRunningReserveBytes: 512 * 1024 ** 2,
      maxConcurrentMediaPerDisk: 1,
    });
  });

  it("parses configured reserves and per-disk concurrency", () => {
    expect(parseCapacityPolicy({
      HELSTERA_SYSTEM_DISK_RESERVE_BYTES: "1073741824",
      HELSTERA_STORAGE_DISK_RESERVE_BYTES: "134217728",
      HELSTERA_MEDIA_ADMISSION_RESERVE_BYTES: "4294967296",
      HELSTERA_MEDIA_RUNNING_RESERVE_BYTES: "1073741824",
      HELSTERA_MEDIA_MAX_CONCURRENT_PER_DISK: "2",
    } as NodeJS.ProcessEnv)).toEqual({
      systemDiskReserveBytes: 1024 ** 3,
      storageDiskReserveBytes: 128 * 1024 ** 2,
      mediaAdmissionReserveBytes: 4 * 1024 ** 3,
      mediaRunningReserveBytes: 1024 ** 3,
      maxConcurrentMediaPerDisk: 2,
    });
  });

  it.each(["0", "-1", "1.5", "1e9", "9007199254740992"])(
    "rejects unsafe disk reserve value %s",
    (value) => {
      expect(() => parseCapacityPolicy({
        HELSTERA_MEDIA_ADMISSION_RESERVE_BYTES: value,
      } as NodeJS.ProcessEnv)).toThrow(/HELSTERA_MEDIA_ADMISSION_RESERVE_BYTES/);
    },
  );

  it.each(["0", "5", "1.5"])(
    "rejects unsafe media concurrency %s",
    (value) => {
      expect(() => parseCapacityPolicy({
        HELSTERA_MEDIA_MAX_CONCURRENT_PER_DISK: value,
      } as NodeJS.ProcessEnv)).toThrow(/HELSTERA_MEDIA_MAX_CONCURRENT_PER_DISK/);
    },
  );
});
