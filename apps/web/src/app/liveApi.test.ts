import { expect, test, vi } from "vitest";
import { ApiClient, Commands } from "../live/api";

test("unknown writes retry the same key; changed commands get a distinct key", async () => {
  const keys: string[] = []; let fail = true;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    keys.push((init?.headers as Record<string,string>)["Idempotency-Key"]);
    if (fail) { fail = false; throw Error("lost response"); }
    return new Response(JSON.stringify({code:"OK",data:{id:"task-1"}}));
  });
  const api = new ApiClient(fetcher as typeof fetch); api.csrf="csrf"; const commands=new Commands(api);
  await expect(commands.run("/tasks",{spool:"a"})).rejects.toThrow("网络请求");
  await expect(commands.run("/tasks",{spool:"a"})).resolves.toEqual({id:"task-1"});
  await commands.run("/tasks",{spool:"b"}); expect(keys[0]).toBe(keys[1]); expect(keys[2]).not.toBe(keys[0]);
  expect(fetcher.mock.calls[1][1]?.credentials).toBe("same-origin");
  expect((fetcher.mock.calls[1][1]?.headers as Record<string,string>)["X-CSRF-Token"]).toBe("csrf");
});
test("expired sessions clear authenticated state and never fall back to demo data", async () => {
  const api=new ApiClient(vi.fn(async()=>new Response(JSON.stringify({code:"AUTH_REQUIRED",message:"请重新登录"}),{status:401})) as typeof fetch);
  const expired=vi.fn();api.onExpired=expired;
  await expect(api.request("/tasks")).rejects.toThrow("请重新登录"); expect(expired).toHaveBeenCalledOnce();
});
test("catalogue pagination follows every server page",async()=>{
  const fetcher=vi.fn(async(url:RequestInfo|URL)=>new Response(JSON.stringify({code:"OK",data:String(url).includes("after_id")?{items:[{id:"b"}],has_more:false,next_cursor:null}:{items:[{id:"a"}],has_more:true,next_cursor:"a"}})));
  expect(await new ApiClient(fetcher as typeof fetch).all("/spools")).toEqual([{id:"a"},{id:"b"}]);
});
