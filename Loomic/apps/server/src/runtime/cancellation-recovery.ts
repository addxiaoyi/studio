export function shouldQuarantineCanceledReplay(input: {
  attemptCount: number;
  cancelRequestedAt: string | null | undefined;
  providerCheckpointExists: boolean;
}): boolean {
  return input.attemptCount > 1 && Boolean(input.cancelRequestedAt) && !input.providerCheckpointExists;
}
