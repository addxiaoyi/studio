export type StudioExport = { id: string; name: string; blob: Blob; createdAt: number; assetId?: string; canvasId?: string; compositionId?: string };
const databaseName = "loomic-visualforge-projects";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 4);
    request.onupgradeneeded = () => {
      for (const store of ["projects", "exports", "editorPlans", "editorChats"]) {
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

export async function adoptCanvasStudioProject(userId: string, projectId: string, canvasId: string): Promise<void> {
  const target = `${userId}:project:${projectId}`, legacy = `${userId}:canvas:${canvasId}`;
  const db = await openDatabase();
  await new Promise<void>((resolve,reject) => {
    const stores = ["projects","editorPlans","editorChats"];
    const tx = db.transaction(stores,"readwrite"), projects = tx.objectStore("projects");
    const existing = projects.get(target);
    existing.onsuccess = () => {
      if (existing.result !== undefined) return;
      const oldProject = projects.get(legacy);
      oldProject.onsuccess = () => {
        if (oldProject.result === undefined) return;
        projects.put(oldProject.result,target);
        for (const name of stores.slice(1)) {
          const store = tx.objectStore(name), request = store.get(legacy);
          request.onsuccess = () => { if (request.result !== undefined) store.put(request.result,target); };
        }
      };
    };
    tx.oncomplete = () => { db.close();resolve(); };
    tx.onerror = tx.onabort = () => { db.close();reject(tx.error ?? new Error("旧画布视频工程迁移失败，原草稿仍保留。")); };
  });
}
export const saveStudioExport = (userId: string, output: StudioExport) => transaction("exports", "readwrite", store => store.put(output, [userId, output.id]));
export const listStudioExports = (userId: string) => transaction<StudioExport[]>("exports", "readonly", store => store.getAll(IDBKeyRange.bound([userId], [userId, []])));

export const readStudioPlan = <T>(userId: string) => transaction<T | undefined>("editorPlans", "readonly", store => store.get(userId));
export const saveStudioPlan = (userId: string, plan: unknown) => transaction("editorPlans", "readwrite", store => store.put(plan, userId));
export const clearStudioPlan = (userId: string) => transaction("editorPlans", "readwrite", store => store.delete(userId));
export const readStudioChat = <T>(userId:string) => transaction<T|undefined>("editorChats","readonly",store=>store.get(userId));
export const saveStudioChat = (userId:string,chat:unknown) => transaction("editorChats","readwrite",store=>store.put(chat,userId));
