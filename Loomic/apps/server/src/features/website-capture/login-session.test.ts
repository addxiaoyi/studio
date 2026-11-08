import { expect, it } from "vitest";
import { allowLoginRequest } from "./login-session.js";
const scope={origin:"https://site.example",submitting:true,username:"viewer@example.test",password:"Secret+123!"};
function request(url:string,method:string,body:string|null=null){return{url:()=>url,method:()=>method,postData:()=>body};}
it("permits only the exact origin's login POST while submitting",()=>{
  expect(allowLoginRequest(request("https://site.example/login","POST","password=Secret%2B123!"),scope)).toBe(true);
  expect(allowLoginRequest(request("https://site.example/login","POST","password=Secret%2B123!"),scope)).toBe(false);
  expect(allowLoginRequest(request("https://evil.example/login","POST","password=Secret%2B123!"),scope)).toBe(false);
  expect(allowLoginRequest(request("https://site.example/delete","POST","id=1"),scope)).toBe(false);
  expect(allowLoginRequest(request("https://site.example/login","POST","password=Secret%2B123!"),{...scope,submitting:false})).toBe(false);
  expect(allowLoginRequest(request("https://evil.example/?q=Secret%2B123!","GET"),scope)).toBe(false);
  expect(allowLoginRequest(request("https://site.example/account","DELETE"),scope)).toBe(false);
});
it("supports form encoding without forwarding a second login POST",()=>{
  const password="with spaces & + symbols!",login={...scope,password,submissions:0};
  expect(allowLoginRequest(request("https://site.example/login","POST",new URLSearchParams({password}).toString()),login)).toBe(true);
  expect(login.submissions).toBe(1);
});
