import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,instant,decimal} from '../../apps/platform/infrastructure/canonical';
import {parseJson,validate} from '../../apps/platform/infrastructure/schema';
test('canonical decimals and microseconds retain exact facts',()=>{
 assert.equal(decimal('-0.000'),'0');assert.equal(decimal('3.0000000001'),'3.0000000001');
 assert.equal(instant('2026-10-21T16:00:00.123456+08:00'),'2026-10-21T08:00:00.123456Z');
 assert.equal(digest({value:'3.000',sample_time:'2026-10-21T16:00:00.123400+08:00'}),digest({sample_time:'2026-10-21T08:00:00.1234Z',value:'3'}));
 assert.notEqual(digest({raw:{data:{value:'1.0'}}}),digest({raw:{data:{value:'1'}}}));
 assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));
});
test('raw JSON parser rejects duplicate properties, unsafe Unicode and overflow',()=>{
 for(const raw of ['{"a":1,"a":2}','{"x":{"a":1,"a":2}}','{"a":"\\ud800"}','{"x":1e999}'])assert.throws(()=>parseJson(raw));
 assert.deepEqual(parseJson('{"a":[{"b":null},true,"\\u4e2d"]}'),{a:[{b:null},true,'中']});
});
test('schema rejects missing required values and unbounded sequence shape',()=>{
 assert.throws(()=>validate('Decimal',3.2));assert.throws(()=>validate('Timestamp','2026-10-21 12:00:00'));assert.throws(()=>validate('Sequence','-1'));
});
