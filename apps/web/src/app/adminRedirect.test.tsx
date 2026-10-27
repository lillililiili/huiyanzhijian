import {createRoot} from 'react-dom/client';
import {act} from 'react';
import {expect,test,vi} from 'vitest';
import {LiveApp} from '../live/LiveApp';

vi.mock('../shared/AdminRedirect',()=>({AdminRedirect:({route,params}:{route:string;params:URLSearchParams})=><p>redirect:{route}?{params.toString()}</p>}));
test('legacy management deep links redirect with query before a business login is required',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({code:'SESSION_EXPIRED',message:'需要登录'}),{status:401})));
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  try{
    for(const route of ['users','audit','settings']){
      await act(async()=>{window.location.hash=route+'?view=logs&page=2';window.dispatchEvent(new HashChangeEvent('hashchange'));root.render(<LiveApp/>);});
      expect(container.textContent).toBe(`redirect:${route}?view=logs&page=2`);
      expect(container.querySelector('#login-form')).toBeNull();
    }
  }finally{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();}
});
