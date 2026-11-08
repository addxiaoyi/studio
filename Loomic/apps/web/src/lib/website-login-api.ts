import type { WebsiteLoginCredentials, WebsiteLoginRef } from "@helstera/shared";
import { getServerBaseUrl } from "./env";

export async function saveWebsiteLoginCredentials(token: string, credentials: WebsiteLoginCredentials): Promise<WebsiteLoginRef> {
  const response = await fetch(`${getServerBaseUrl()}/api/website-capture/login-credentials`, {
    method:"POST", credentials:"include", cache:"no-store", redirect:"error",
    headers:{"Content-Type":"application/json",...(token==="local-cookie"?{}:{Authorization:`Bearer ${token}`})},
    body:JSON.stringify(credentials),
  });
  const payload = await response.json();
  if(!response.ok)throw new Error(payload.error?.message??"登录凭据提交失败，请重试。");
  return payload.data;
}
