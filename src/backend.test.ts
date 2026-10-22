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
 const api=await import("./backend");await expect(api.signIn("a@example.com","password")).rejects.toThrow("Сетевой запрос");
});

it("retries an interrupted account response body with a fresh signal",async()=>{
 const broken=new Response(new ReadableStream({start(c){c.error(new DOMException("Fetch is aborted","AbortError"));}}));
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(token())))
 .mockResolvedValueOnce(broken).mockResolvedValueOnce(new Response(JSON.stringify({state:{pets:[]}})));
 vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
 const s=await api.signIn("a@example.com","password");
 await expect(api.rpc(s,"load_shared_state",{})).resolves.toEqual({state:{pets:[]}});
 expect(fetcher).toHaveBeenCalledTimes(3);
 expect(fetcher.mock.calls[1][1].signal).not.toBe(fetcher.mock.calls[2][1].signal);
});
it("does not retry a write if its response stream fails",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(token())))
 .mockResolvedValueOnce(new Response(new ReadableStream({start(c){c.error(new DOMException("Fetch is aborted","AbortError"));}})));
 vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
 const s=await api.signIn("a@example.com","password");
 await expect(api.rpc(s,"save_shared_state",{})).rejects.toThrow("Сетевой запрос");
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it("bounds retries and preserves the account when offline",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(token()))).mockRejectedValue(new TypeError("Failed to fetch"));
 vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
 const s=await api.signIn("a@example.com","password");
 await expect(api.rpc(s,"load_shared_state",{})).rejects.toThrow("повторите");
 expect(fetcher).toHaveBeenCalledTimes(3);expect(api.readStoredSession()?.user.id).toBe("a");
});
it("clears the timeout after reading the body",async()=>{
 vi.useFakeTimers();
 try {
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(token())));
 vi.stubGlobal("fetch",fetcher);const api=await import("./backend");
 await api.signIn("a@example.com","password");
 expect(vi.getTimerCount()).toBe(0);
 await vi.advanceTimersByTimeAsync(61000);
 expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
 }finally{vi.useRealTimers();}
});
