const {test}=require('node:test'),assert=require('node:assert/strict');
const {createResponseCache}=require('../customerHistoryResponseCache');
test('shared cache coalesces callers, expires and never caches errors',async()=>{
 let now=0,calls=0;const cache=createResponseCache({ttl:60,now:()=>now});
 const loader=async()=>{calls++;await new Promise(r=>setImmediate(r));return {ok:true};};
 await Promise.all(Array.from({length:12},()=>cache.get('page',loader)));assert.equal(calls,1);
 await cache.get('page',loader);assert.equal(calls,1);now=61;await cache.get('page',loader);assert.equal(calls,2);
 for(let i=0;i<2;i++)await assert.rejects(cache.get('error',async()=>{calls++;throw Error('offline');}));assert.equal(calls,4);
});
test('cache enforces entry/byte budgets; oversized histories are not retained',async()=>{
 const cache=createResponseCache({maxBytes:80,maxEntries:2});
 for(let i=0;i<20;i++)await cache.get(String(i),async()=>({i,pad:'x'.repeat(20)}));
 assert.ok(cache.stats().entries<=2);assert.ok(cache.stats().bytes<=80);
 await cache.get('huge',async()=>({pad:'x'.repeat(1000)}));assert.ok(cache.stats().bytes<=80);
});
