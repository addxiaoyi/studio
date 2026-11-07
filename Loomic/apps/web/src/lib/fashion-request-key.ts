function readPhoto(photo: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取照片，请重新选择。"));
    reader.onabort = () => reject(new Error("照片读取已中断，请重新选择。"));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) return reject(new Error("无法读取照片，请重新选择。"));
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(photo);
  });
}

export async function fashionRequestKey(userId: string, outfit: { id: string; image: string }, photo: File) {
  if (!userId || !globalThis.crypto?.subtle || !globalThis.crypto.randomUUID) {
    throw new Error("无法安全准备试穿请求，请检查浏览器和登录状态。");
  }
  const photoHash = await crypto.subtle.digest("SHA-256", await readPhoto(photo));
  const digest = Array.from(new Uint8Array(photoHash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `helstera:fashion-request:${JSON.stringify([userId, outfit.id, outfit.image, digest])}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return { storageKey, requestKey: existing };
    const requestKey = crypto.randomUUID();
    sessionStorage.setItem(storageKey, requestKey);
    return { storageKey, requestKey };
  } catch {
    throw new Error("无法保存试穿重试信息，请启用浏览器会话存储后重试。");
  }
}
