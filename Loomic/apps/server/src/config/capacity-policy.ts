const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const MIN_RESERVE_BYTES = 16 * MIB;
const MAX_RESERVE_BYTES = 1024 ** 4;
const MAX_MEDIA_CONCURRENCY = 4;

export type CapacityPolicy = Readonly<{
  systemDiskReserveBytes: number;
  storageDiskReserveBytes: number;
  mediaAdmissionReserveBytes: number;
  mediaRunningReserveBytes: number;
  maxConcurrentMediaPerDisk: number;
}>;

export type CapacityDiskStatus = Readonly<{
  path: string;
  labels: string[];
  availableBytes: number;
  requiredBytes: number;
  shortageBytes: number;
}>;

export type CapacityDiagnostics = Readonly<{
  disks: CapacityDiskStatus[];
}>;

export const DEFAULT_CAPACITY_POLICY: CapacityPolicy = Object.freeze({
  systemDiskReserveBytes: 512 * MIB,
  storageDiskReserveBytes: 64 * MIB,
  mediaAdmissionReserveBytes: 2 * GIB,
  mediaRunningReserveBytes: 512 * MIB,
  maxConcurrentMediaPerDisk: 1,
});

const RESERVE_SETTINGS = [
  ["HELSTERA_SYSTEM_DISK_RESERVE_BYTES", "systemDiskReserveBytes"],
  ["HELSTERA_STORAGE_DISK_RESERVE_BYTES", "storageDiskReserveBytes"],
  ["HELSTERA_MEDIA_ADMISSION_RESERVE_BYTES", "mediaAdmissionReserveBytes"],
  ["HELSTERA_MEDIA_RUNNING_RESERVE_BYTES", "mediaRunningReserveBytes"],
] as const;

export function parseCapacityPolicy(source: NodeJS.ProcessEnv): CapacityPolicy {
  const policy = { ...DEFAULT_CAPACITY_POLICY };
  for (const [setting, key] of RESERVE_SETTINGS) {
    policy[key] = parseReserve(setting, source[setting], policy[key]);
  }

  const concurrencySetting = "HELSTERA_MEDIA_MAX_CONCURRENT_PER_DISK";
  const rawConcurrency = source[concurrencySetting]?.trim();
  if (rawConcurrency) {
    if (!/^\d+$/.test(rawConcurrency)) {
      throw new Error(`${concurrencySetting} must be an integer between 1 and ${MAX_MEDIA_CONCURRENCY}.`);
    }
    const concurrency = Number(rawConcurrency);
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_MEDIA_CONCURRENCY) {
      throw new Error(`${concurrencySetting} must be an integer between 1 and ${MAX_MEDIA_CONCURRENCY}.`);
    }
    policy.maxConcurrentMediaPerDisk = concurrency;
  }

  return policy;
}

function parseReserve(setting: string, raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw invalidReserve(setting);

  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < MIN_RESERVE_BYTES || bytes > MAX_RESERVE_BYTES) {
    throw invalidReserve(setting);
  }
  return bytes;
}

function invalidReserve(setting: string): Error {
  return new Error(`${setting} must be an integer from ${MIN_RESERVE_BYTES} to ${MAX_RESERVE_BYTES} bytes.`);
}
