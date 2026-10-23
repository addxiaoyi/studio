type LocalDirectory = {
  name: string;
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
  queryPermission: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<LocalDirectory>;
};

const DATABASE_NAME = "helstera-local-assets";
const STORE_NAME = "directories";
const FOLDER_KEY = "asset-library";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage settings."));
  });
}

async function readDirectory(): Promise<LocalDirectory | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(FOLDER_KEY);
      request.onsuccess = () => resolve((request.result as LocalDirectory | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the selected local folder."));
    });
  } finally {
    database.close();
  }
}

async function writeDirectory(directory: LocalDirectory): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(directory, FOLDER_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remember the selected folder."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Saving the selected folder was cancelled."));
    });
  } finally {
    database.close();
  }
}

export async function chooseLocalAssetFolder(): Promise<string> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("This browser does not support direct folder storage. Use Edge or Chrome to choose a local folder.");
  const directory = await picker({ mode: "readwrite" });
  await writeDirectory(directory);
  return directory.name;
}

export async function getLocalAssetFolderName(): Promise<string | null> {
  return (await readDirectory())?.name ?? null;
}

export function localAssetFileName(value: string, mimeType: string, mediaType: "image" | "video"): string {
  const normalized = value.normalize("NFKC").replace(/[<>:\"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim();
  const base = (normalized.slice(0, 120) || "helstera-asset").replace(/\.[a-z0-9]{1,8}$/i, "").replace(/^[. -]+|[. ]+$/g, "") || "helstera-asset";
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]?.replace(/[^a-z0-9.+-]/gi, "") || (mediaType === "video" ? "mp4" : "png");
  return `${base}.${extension}`;
}

export async function saveAssetToLocalFolder(input: {
  url: string;
  accessToken: string;
  fileName: string;
  mediaType: "image" | "video";
}): Promise<void> {
  const directory = await readDirectory();
  if (!directory) throw new Error("Choose a local asset folder first.");
  const options = { mode: "readwrite" as const };
  let permission = await directory.queryPermission(options);
  if (permission !== "granted") permission = await directory.requestPermission(options);
  if (permission !== "granted") throw new Error("Folder access was not granted. Choose the local folder again to continue.");

  const response = await fetch(input.url, { headers: { Authorization: `Bearer ${input.accessToken}` } });
  if (!response.ok) throw new Error(`Could not download this asset (${response.status}).`);
  const blob = await response.blob();
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? blob.type;
  const expectedType = input.mediaType === "video" ? "video/" : "image/";
  if (!contentType.startsWith(expectedType)) throw new Error("The downloaded file type does not match this asset.");

  const fileName = localAssetFileName(input.fileName, contentType, input.mediaType);
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try {
      await writable.close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], "Writing the local asset failed and the file could not be closed cleanly.");
    }
    throw error;
  }
}
