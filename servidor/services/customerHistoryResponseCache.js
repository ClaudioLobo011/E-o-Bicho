// Short-lived, bounded, process-local cache. Authentication runs BEFORE every read.
// Share work between store hosts without retaining an unbounded customer directory.
function createResponseCache({ttl=60000,maxBytes=16*1024*1024,maxEntries=128,now=Date.now}={}) {
  const values=new Map(),pending=new Map();let bytes=0;
  const remove=key=>{const row=values.get(key);if(row){bytes-=row.bytes;values.delete(key);}};
  return {
    async get(key,loader){
      const existing=values.get(key);
      if(existing&&existing.expires>now())return existing.value;
      remove(key);
      if(pending.has(key))return pending.get(key);
      const task=Promise.resolve().then(loader).then(value=>{
        const size=Buffer.byteLength(JSON.stringify(value));
        if(size<=maxBytes){
          for(const [k,row] of values)if(row.expires<=now())remove(k);
          while(values.size>=maxEntries||bytes+size>maxBytes)remove(values.keys().next().value);
          values.set(key,{value,bytes:size,expires:now()+ttl});bytes+=size;
        }
        return value;
      }).finally(()=>pending.delete(key));
      // Do not keep unlimited pending keys under high concurrency.
      if(pending.size<maxEntries)pending.set(key,task);
      return task;
    },
    stats:()=>({entries:values.size,bytes,pending:pending.size}),
    clear(){values.clear();bytes=0;},
  };
}
module.exports={createResponseCache};
