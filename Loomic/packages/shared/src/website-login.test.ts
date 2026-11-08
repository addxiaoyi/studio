import { describe, expect, it } from "vitest";
import { createWebsiteCaptureRequestSchema } from "./website-capture.js";
import { websiteLoginCredentialsSchema } from "./website-login.js";
const login={credentialId:"00000000-0000-4000-8000-000000000001",loginUrl:"https://example.com/login",successText:"我的工作台"};
const capture={url:"https://example.com/dashboard",mode:"isolated",recordVideo:true,followExternal:false,idempotencyKey:"login-test",login};
describe("website login scope",()=>{
  it("accepts one HTTPS origin with recording approval",()=>expect(createWebsiteCaptureRequestSchema.parse(capture).login).toEqual(login));
  it.each([{mode:"local"},{recordVideo:false},{followExternal:true},{url:"https://other.example/dashboard"},{login:{...login,loginUrl:"http://example.com/login"}},{login:{...login,loginUrl:"https://user:password@example.com/login"}}])("rejects scope changes %j",change=>expect(createWebsiteCaptureRequestSchema.safeParse({...capture,...change}).success).toBe(false));
  it("never accepts raw credentials as task login metadata",()=>{
    const parsed=createWebsiteCaptureRequestSchema.parse({...capture,login:{...login,username:"private",password:"private"}});
    expect(JSON.stringify(parsed)).not.toContain("private");
    expect(websiteLoginCredentialsSchema.safeParse({loginUrl:login.loginUrl,successText:login.successText,username:"a",password:""}).success).toBe(false);
  });
});
