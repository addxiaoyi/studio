export type StudioExport = { id: string; name: string; blob: Blob; createdAt: number; assetId?: string };
const databaseName = "loomic-visualforge-projects";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 3);
    request.onupgradeneeded = () => {
      for (const store of ["projects", "exports", "editorPlans"]) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他旧版视频工作区后重试本机存储升级。"));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

async function transaction<T>(store: string, mode: IDBTransactionMode, execute: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = execute(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error || request.error || new Error("本机存储操作失败。")); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("本机存储操作已中止。")); };
  });
}

export const readStudioProject = <T>(userId: string) => transaction<T | undefined>("projects", "readonly", store => store.get(userId));
export const saveStudioProject = (userId: string, project: unknown) => transaction("projects", "readwrite", store => store.put(project, userId));
export const saveStudioExport = (userId: string, output: StudioExport) => transaction("exports", "readwrite", store => store.put(output, [userId, output.id]));
export const listStudioExports = (userId: string) => transaction<StudioExport[]>("exports", "readonly", store => store.getAll(IDBKeyRange.bound([userId], [userId, []])));

export const readStudioPlan = <T>(userId: string) => transaction<T | undefined>("editorPlans", "readonly", store => store.get(userId));
export const saveStudioPlan = (userId: string, plan: unknown) => transaction("editorPlans", "readwrite", store => store.put(plan, userId));
