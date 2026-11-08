import { z } from "zod";

// Shared contracts target ES without DOM types; both supported runtimes expose WHATWG URL.
declare const URL: new (input: string) => {protocol:string;origin:string;username:string;password:string;hash:string};

const httpsUrl = z.string().trim().url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
}, "登录网址必须为不含账号信息的 HTTPS 地址。");
const selector = z.string().trim().min(1).max(300).optional();
export const websiteLoginSettingsSchema = z.object({
  loginUrl: httpsUrl,
  successText: z.string().trim().min(1).max(120),
  usernameSelector: selector,
  passwordSelector: selector,
  submitSelector: selector,
});
export const websiteLoginRefSchema = websiteLoginSettingsSchema.extend({ credentialId: z.string().uuid() });
export const websiteLoginCredentialsSchema = websiteLoginSettingsSchema.extend({
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(2048),
}).strict();
export type WebsiteLoginSettings = z.infer<typeof websiteLoginSettingsSchema>;
export type WebsiteLoginRef = z.infer<typeof websiteLoginRefSchema>;
export type WebsiteLoginCredentials = z.infer<typeof websiteLoginCredentialsSchema>;

export function sameWebsiteOrigin(url: string, loginUrl: string): boolean {
  try {
    const target = new URL(url), login = new URL(loginUrl);
    return target.protocol === "https:" && target.origin === login.origin && !target.username && !target.password;
  } catch { return false; }
}
