import { beforeEach, afterEach, it, expect, vi } from "vitest";
const session = {accessToken:"recovery-access",refreshToken:"recovery-refresh",expiresAt:Date.now()+3600000,user:{id:"a",email:"a@example.com"}};
beforeEach(()=>{
  vi.resetModules();vi.stubEnv("VITE_SUPABASE_URL","https://test.supabase.co");vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY","sb_publishable_test");vi.stubEnv("BASE_URL","/ryadom-app/");
  for(const name of ["localStorage","sessionStorage"]) {
    const values=new Map<string,string>();
    vi.stubGlobal(name,{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
  }
  vi.stubGlobal("location",{hash:"",origin:"https://pavelmashina.github.io",pathname:"/ryadom-app/",search:""});
  vi.stubGlobal("history",{replaceState:vi.fn(()=>{location.hash="";})});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("sends a reset request with the deployed subpath and no password",async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response("{}"));vi.stubGlobal("fetch",fetcher);
  const api=await import("./backend");await api.requestPasswordReset(" a@example.com ");
  expect(fetcher.mock.calls[0][0]).toBe("https://test.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fpavelmashina.github.io%2Fryadom-app%2F");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({email:"a@example.com"});
});
it("surfaces email throttling instead of claiming the email was sent",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:429})));
  const api=await import("./backend");await expect(api.requestPasswordReset("a@example.com")).rejects.toThrow("Подождите");
});
it("verifies recovery credentials, removes fragment, and preserves another account",async()=>{
  location.hash="#type=recovery&access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600";
  localStorage.setItem("ryadom:auth:v1",JSON.stringify({...session,user:{id:"b"}}));
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(JSON.stringify(session.user))));
  const api=await import("./backend");expect((await api.readRecoverySession())?.user.id).toBe("a");
  expect(location.hash).toBe("");expect(api.readStoredSession()?.user.id).toBe("b");
  expect((await api.readRecoverySession())?.user.id).toBe("a");
});
it("rejects invalid or consumed email links and clears the URL",async()=>{
  location.hash="#error=access_denied&error_code=otp_expired";
  const api=await import("./backend");await expect(api.readRecoverySession()).rejects.toThrow("устарела");expect(location.hash).toBe("");
});
it("rejects forged recovery tokens before presenting a new password",async()=>{
  location.hash="#type=recovery&access_token=invalid&refresh_token=invalid&expires_in=3600";
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:401})));
  const api=await import("./backend");await expect(api.readRecoverySession()).rejects.toThrow("недействительна");expect(sessionStorage.getItem("ryadom:recovery:v1")).toBeNull();
});
it("rejects expired recovery sessions without a request",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  sessionStorage.setItem("ryadom:recovery:v1",JSON.stringify({...session,expiresAt:1}));
  const api=await import("./backend");await expect(api.readRecoverySession()).rejects.toThrow("устарела");expect(fetcher).not.toHaveBeenCalled();
});
it("validates minimum length and matching passwords before sending",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
  await expect(api.resetPassword(session,"short","short")).rejects.toThrow("8 символов");
  await expect(api.resetPassword(session,"longpassword","different")).rejects.toThrow("не совпадают");expect(fetcher).not.toHaveBeenCalled();
});
it("uses recovery credentials to update password and clears temporary credentials",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(session.user))).mockResolvedValueOnce(new Response(null,{status:204}));vi.stubGlobal("fetch",fetcher);
  sessionStorage.setItem("ryadom:recovery:v1",JSON.stringify(session));localStorage.setItem("ryadom:auth:v1",JSON.stringify({...session,user:{id:"b"}}));
  const api=await import("./backend");await api.resetPassword(session,"new-password-1","new-password-1");
  expect(fetcher.mock.calls[0][1].method).toBe("PUT");expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer recovery-access");
  expect(sessionStorage.getItem("ryadom:recovery:v1")).toBeNull();expect(api.readStoredSession()?.user.id).toBe("b");
});
it("does not clear a valid recovery session when the new password is rejected",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({code:"same_password"}),{status:422})));
  sessionStorage.setItem("ryadom:recovery:v1",JSON.stringify(session));const api=await import("./backend");
  await expect(api.resetPassword(session,"new-password-1","new-password-1")).rejects.toThrow("отличаться");expect(sessionStorage.getItem("ryadom:recovery:v1")).not.toBeNull();
});
