import {expect,test,vi,afterEach} from 'vitest';
import {ApiClient} from '../shared/api';
import {applicationUrl} from '../shared/applicationLinks';
afterEach(()=>vi.unstubAllEnvs());
const session=(id='a',csrf='csrf-a',factory='f')=>({user:{id,factory_id:factory,permissions:['data:read']},csrf_token:csrf});
const response=(data:unknown,status=200)=>new Response(JSON.stringify({code:status===200?'OK':'SESSION_EXPIRED',data}),{status});
test('default cross-app links preserve host, route and query without loopback assumption',()=>{
  expect(applicationUrl('admin','audit?view=logs&request_id=abc','https://plant.example:4181/#tasks')).toBe('https://plant.example:4182/#audit?view=logs&request_id=abc');
});
test('deployment config supports distinct domain and path; rejects unsafe schemes',()=>{
  vi.stubEnv('VITE_ADMIN_APP_URL','https://admin.example/control/');
  expect(applicationUrl('admin','users','https://business.example/')).toBe('https://admin.example/control/#users');
  vi.stubEnv('VITE_ADMIN_APP_URL','javascript:alert(1)');
  expect(()=>applicationUrl('admin','users')).toThrow('HTTP');
});
test('same identity renewed session obtains current CSRF before writing',async()=>{
  const send=vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response(session('a','new-csrf'))).mockResolvedValueOnce(response({saved:true}));
  const api=new ApiClient(send);api.guardSession=true;await api.request('/auth/me');await api.request('/admin/settings/personal',{density:'compact'},{'Idempotency-Key':'one'});
  expect(send.mock.calls[2][1].headers).toMatchObject({'X-CSRF-Token':'new-csrf','Idempotency-Key':'one'});
});
test('changed account or factory never receives a pending mutation',async()=>{
  for(const next of [session('b'),session('a','c','other')]){
    const send=vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response(next));const api=new ApiClient(send);api.guardSession=true;api.onExpired=vi.fn();await api.request('/auth/me');
    await expect(api.request('/admin/settings/personal',{})).rejects.toMatchObject({code:'SESSION_CHANGED'});expect(send).toHaveBeenCalledTimes(2);expect(api.onExpired).toHaveBeenCalled();
  }
});
test('cross-app logout prevents writes and clears the stale UI session',async()=>{
  const send=vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response(null,401));const api=new ApiClient(send);api.guardSession=true;api.onExpired=vi.fn();await api.request('/auth/me');
  await expect(api.request('/admin/settings/personal',{})).rejects.toMatchObject({status:401});expect(send).toHaveBeenCalledTimes(2);expect(api.onExpired).toHaveBeenCalled();
});
