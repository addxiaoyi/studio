import { LocalStorageProvider } from "./local-storage.js";
import type { StorageProvider } from "./storage-provider.js";

type CreateStorageProviderOptions = {
  provider: "local";
  root: string;
  baseUrl: string;
};

export function createStorageProvider(
  options: CreateStorageProviderOptions,
): StorageProvider {
  return new LocalStorageProvider(options.root, options.baseUrl);
}
