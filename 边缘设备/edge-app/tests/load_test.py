import json,time,urllib.request,sys,os
BASE='http://127.0.0.1:4199'
def call(path,body=None):
    if body is None:return json.load(urllib.request.urlopen(BASE+'/api/'+path))
    token=call('state')['csrf'];req=urllib.request.Request(BASE+'/api/'+path,json.dumps(body).encode(),{'Content-Type':'application/json','X-Edge-CSRF':token});return json.load(urllib.request.urlopen(req))

results=[]
for transport,interval,duration in [('tcp',20,30),('tcp',10,30),('tcp',5,30),('rtu',10,30)]:
    cfg=call('state')['config'];cfg.update(transport=transport,endpoint='127.0.0.1:15020' if transport=='tcp' else open('/config/edge-build/lab-serial.txt').read(),intervalMs=interval,baud=115200,lower=.98)
    call('config',cfg);call('start',{'code':'EDGE01-PERF-'+transport+str(interval),'spool':'ISOLATED-'+str(time.time_ns()),'spec':'协议负载测试','length':500});start=time.monotonic();time.sleep(duration);end=call('end',{});elapsed=time.monotonic()-start;r=end['run'];records=[];after=0
    while True:
        page=call('records?run='+r['id']+'&after='+str(after))
        if not page:break
        records.extend(page);after=page[-1]['id']
    ids=[s['id'] for s in records]
    assert len(ids)==r['count'] and len(set(ids))==len(ids), 'lost/duplicate records'
    assert r['count']/elapsed >= 1000/interval*.90, 'insufficient throughput'
    assert all(s['ratio']==min(s['x'],s['y'])/max(s['x'],s['y']) for s in records if s['valid'])
    time.sleep(2);s=call('state');assert s['vmPending']==0, s
    results.append({'transport':transport,'targetHz':1000/interval,'duration':elapsed,'persisted':r['count'],'actualHz':r['count']/elapsed,'invalid':r['invalid'],'below':r['below'],'vmPending':s['vmPending'],'run':r['id']})
    print(json.dumps(results[-1],ensure_ascii=False),flush=True)
with open('/config/edge-build/load-results.json','w') as f:json.dump(results,f,ensure_ascii=False,indent=2)
