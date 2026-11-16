import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_CAPACITY_POLICY,
  type CapacityDiagnostics,
  type CapacityPolicy,
} from "../config/capacity-policy.js";

export class StorageCapacityError extends Error {
  readonly code = "storage_capacity_low";

  constructor(readonly details: CapacityDiagnostics) {
    super("Storage reserve is below its configured requirement.");
    this.name = "StorageCapacityError";
  }
}

export async function probeWritableStorage(
  root: string,
  policy: CapacityPolicy = DEFAULT_CAPACITY_POLICY,
) {
  const directory = await realpath(root);
  const media = join(directory, ".media-tmp");
  await mkdir(media, { recursive: true, mode: 0o700 });
  const checks = [
    {
      label: "system",
      path: await realpath("/"),
      required: BigInt(policy.systemDiskReserveBytes),
    },
    {
      label: "storage",
      path: directory,
      required: BigInt(policy.storageDiskReserveBytes),
    },
    {
      label: "media",
      path: await realpath(media),
      required: BigInt(policy.mediaRunningReserveBytes),
    },
  ];
  const disks = new Map<
    bigint,
    { path: string; labels: string[]; required: bigint; available: bigint }
  >();
  for (const check of checks) {
    const [identity, space] = await Promise.all([
      stat(check.path, { bigint: true }),
      statfs(check.path, { bigint: true }),
    ]);
    const available = space.bavail * space.bsize;
    const current = disks.get(identity.dev);
    if (current) {
      current.labels.push(check.label);
      current.required =
        current.required > check.required ? current.required : check.required;
      current.available =
        current.available < available ? current.available : available;
    } else {
      disks.set(identity.dev, {
        path: check.path,
        labels: [check.label],
        required: check.required,
        available,
      });
    }
  }
  const report: CapacityDiagnostics = {
    disks: [...disks.values()].map(({ path, labels, required, available }) => ({
      path,
      labels,
      requiredBytes: Number(required),
      availableBytes: Number(available),
      shortageBytes: Number(required > available ? required - available : 0n),
    })),
  };
  if (report.disks.some((disk) => disk.shortageBytes > 0)) {
    throw new StorageCapacityError(report);
  }

  await probeWritable(directory);
  if (!checks[1] || !checks[2] || checks[1].path !== checks[2].path)
    await probeWritable(media);
  return { ok: true, ...report };
}

async function probeWritable(directory: string) {
  const path = join(directory, `.helstera-ready-${randomUUID()}`);
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile("ready");
    await file.sync();
  } finally {
    try {
      await file.close();
    } finally {
      await unlink(path);
    }
  }
}
