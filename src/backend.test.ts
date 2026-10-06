import { beforeEach,afterEach,it,expect,vi } from "vitest";
beforeEach(()=>{
 vi.resetModules();vi.stubEnv("VITE_SUPABASE_URL","https://test.supabase.co");vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY","sb_publishable_test");
 const storage=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const token=(id="a")=>({access_token:"access-"+id,refresh_token:"refresh-"+id,expires_in:3600,user:{id,email:id+"@example.com"}});
it("signs in and clears session on sign-out",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(token()))).mockResolvedValueOnce(new Response(null,{status:204})));
 const api=await import("./backend");const s=await api.signIn("a@example.com","password");
 expect(api.readStoredSession()?.user.id).toBe("a");await api.signOut(s);expect(api.readStoredSession()).toBeNull();
});
it("registration waits for email confirmation without inventing a session",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({user:{id:"a"}}))));
 const api=await import("./backend");expect(await api.signUp("a@example.com","password")).toEqual({session:null,needsEmailConfirmation:true});
 expect(api.readStoredSession()).toBeNull();
});
it("does not send an A snapshot using B credentials",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(token("a")))).mockResolvedValueOnce(new Response(JSON.stringify(token("b"))));
 vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
 const a=await api.signIn("a@example.com","password");await api.signIn("b@example.com","password");
 await expect(api.rpc(a,"save_app_state",{})).rejects.toThrow("Аккаунт изменился");expect(fetcher).toHaveBeenCalledTimes(2);
});
it("reports a version conflict immediately",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(token()))).mockResolvedValueOnce(new Response(JSON.stringify({code:"PT409"}),{status:409})));
 const api=await import("./backend");const s=await api.signIn("a@example.com","password");
 await expect(api.rpc(s,"save_app_state",{})).rejects.toThrow("другом устройстве");
});
it("does not claim success on network failure",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
 const api=await import("./backend");await expect(api.signIn("a@example.com","password")).rejects.toThrow("Нет связи");
});
