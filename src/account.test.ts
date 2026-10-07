import { beforeEach,afterEach,it,expect,vi } from "vitest";
const session={accessToken:"access-a",refreshToken:"refresh-a",expiresAt:Date.now()+3600000,user:{id:"a",email:"old@example.com"}};
beforeEach(()=>{
 vi.resetModules();vi.stubEnv("VITE_SUPABASE_URL","https://test.supabase.co");vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY","sb_publishable_test");vi.stubEnv("BASE_URL","/ryadom-app/");
 const storage=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
 vi.stubGlobal("location",{origin:"https://pavelmashina.github.io"});localStorage.setItem("ryadom:auth:v1",JSON.stringify(session));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("loads confirmed account details and keeps tokens after reload",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"a",email:"confirmed@example.com",created_at:"2026-10-01T00:00:00Z"}))));
 const api=await import("./backend");await api.getAccountUser(session);
 expect((await api.getValidSession())?.user.email).toBe("confirmed@example.com");expect(api.readStoredSession()?.accessToken).toBe("access-a");
});
it("requests an email change without declaring the new email confirmed",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({...session.user,new_email:"new@example.com"})));vi.stubGlobal("fetch",fetcher);
 const api=await import("./backend");const user=await api.changeEmail(session," new@example.com ");
 expect(user.email).toBe("old@example.com");expect(user.new_email).toBe("new@example.com");
 expect(fetcher.mock.calls[0][0]).toContain("redirect_to=https%3A%2F%2Fpavelmashina.github.io%2Fryadom-app%2F");
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({email:"new@example.com"});
});
it("rejects invalid or unchanged email without a server request",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
 await expect(api.changeEmail(session,"broken")).rejects.toThrow("корректный");
 await expect(api.changeEmail(session," OLD@example.com ")).rejects.toThrow("новый");expect(fetcher).not.toHaveBeenCalled();
});
it("validates passwords before updating the authenticated user",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
 await expect(api.changePassword(session,"short","short","old")).rejects.toThrow("8 символов");
 await expect(api.changePassword(session,"new-password","different","old")).rejects.toThrow("не совпадают");
 await expect(api.changePassword(session,"new-password","new-password","")).rejects.toThrow("текущий");expect(fetcher).not.toHaveBeenCalled();
});
it("sends current password and new password only to Supabase Auth",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(session.user)));vi.stubGlobal("fetch",fetcher);
 const api=await import("./backend");await api.changePassword(session,"new-password","new-password","current-password");
 expect(fetcher.mock.calls[0][1].method).toBe("PUT");expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer access-a");
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({password:"new-password",current_password:"current-password"});
 expect(JSON.stringify(api.readStoredSession())).not.toContain("current-password");
});
it("does not update A with B credentials",async()=>{
 localStorage.setItem("ryadom:auth:v1",JSON.stringify({...session,user:{id:"b"}}));const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 const api=await import("./backend");await expect(api.changeEmail(session,"new@example.com")).rejects.toThrow("Аккаунт изменился");expect(fetcher).not.toHaveBeenCalled();
});
it("does not overwrite B if the account changes while A's update is in flight",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>{localStorage.setItem("ryadom:auth:v1",JSON.stringify({...session,user:{id:"b"}}));return new Response(JSON.stringify(session.user));}));
 const api=await import("./backend");await expect(api.changeEmail(session,"new@example.com")).rejects.toThrow("Аккаунт изменился");expect(api.readStoredSession()?.user.id).toBe("b");
});
it("explains when Supabase requires a recent login",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({code:"reauthentication_needed"}),{status:400})));
 const api=await import("./backend");await expect(api.changePassword(session,"new-password","new-password","old")).rejects.toThrow("войдите снова");
});
