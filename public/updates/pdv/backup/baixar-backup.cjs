const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {pipeline}=require('node:stream/promises');
const {Readable}=require('node:stream');
async function hash(filename){const h=crypto.createHash('sha256');for await(const c of fs.createReadStream(filename))h.update(c);return h.digest('hex');}
async function decryptBackup(filename,privateKey,output,expectedJob,expectedHost){
 const handle=await fsp.open(filename,'r');let header,offset,tag;
 try{
  const first=Buffer.alloc(8192);const {bytesRead}=await handle.read(first,0,first.length,0);offset=first.subarray(0,bytesRead).indexOf(10)+1;
  if(offset<1)throw Error('Cabecalho invalido');header=first.subarray(0,offset);
  const size=(await handle.stat()).size;tag=Buffer.alloc(16);await handle.read(tag,0,16,size-16);
 }finally{await handle.close();}
 const meta=JSON.parse(header.toString());
 if(meta.format!=='eobicho-sqlite-v1'||meta.jobId!==expectedJob||meta.hostId!==expectedHost)throw Error('Identidade do backup divergente');
 const key=crypto.privateDecrypt({key:privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(meta.key,'base64'));
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(meta.iv,'base64'));decipher.setAuthTag(tag);decipher.setAAD(header);
 const partial=output+'.partial';
 try{
  const end=(await fsp.stat(filename)).size-17;
  await pipeline(fs.createReadStream(filename,{start:offset,end}),decipher,zlib.createGunzip(),fs.createWriteStream(partial,{flags:'wx',mode:0o600}));
  if((await fsp.stat(partial)).size!==meta.sqliteBytes||await hash(partial)!==meta.sqliteSha256)throw Error('Integridade do SQLite divergente');
  const {DatabaseSync}=require('node:sqlite');const check=new DatabaseSync(partial,{readOnly:true});
  try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('SQLite invalido');}finally{check.close();}
  if(fs.existsSync(output))throw Error('Arquivo de destino ja existe');
  await fsp.rename(partial,output);return meta;
 }finally{key.fill(0);await fsp.rm(partial,{force:true});}
}
async function main(){
 const loja=process.argv[2]||'',folder=process.argv[3];
 const base='https://api.peteobicho.com.br';
 const identifier=process.env.PDV_BACKUP_USER,senha=process.env.PDV_BACKUP_PASSWORD;
 delete process.env.PDV_BACKUP_USER;delete process.env.PDV_BACKUP_PASSWORD;
 if(!folder||!identifier||!senha)throw Error('Execute pelo Baixar-Backup-PDV.ps1');
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,senha}),signal:AbortSignal.timeout(20000)});
 const auth=await login.json();if(!login.ok||!auth.token)throw Error(auth.message||'Falha no login');
 async function api(route,body){const r=await fetch(base+'/api/desktop/remote-backup'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const p=await r.json().catch(()=>({}));if(!r.ok)throw Error(p.message||'HTTP '+r.status);return p;}
 const hosts=(await api('/hosts')).hosts;
 const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
 const matches=hosts.filter(h=>normalize([h.name,h.pdv?.nome,h.pdv?.codigo,h.empresa?.nome,h.empresa?.nomeFantasia,h.empresa?.razaoSocial].join(' ')).includes(normalize(loja)));
 if(!loja||matches.length!==1){console.log(hosts.map(h=>({id:h._id,pdv:h.pdv?.codigo,nome:h.name,loja:h.empresa?.nome||h.empresa?.nomeFantasia,version:h.appVersion})));throw Error('Informe um nome unico de loja/PDV. Nenhum backup solicitado.');}
 const host=matches[0];
 console.log('Servidor selecionado: '+host.name+' / '+host.pdv?.codigo);
 const keys=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
 const job=await api('/jobs',{hostId:host._id,publicKey:keys.publicKey.export({type:'spki',format:'pem'})});
 console.log('Backup solicitado. Aguarde o servidor da loja (ate 1 minuto para receber o pedido).');
 let ready;
 while(Date.now()<Date.parse(job.expiresAt)-15000){
  const status=await api('/jobs/'+job.id);
  if(status.status==='ready'){ready=status;break;}
  if(['failed','expired'].includes(status.status))throw Error('Backup nao concluido; nenhum banco da loja foi alterado.');
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(!ready)throw Error('Tempo de espera esgotado');
 await fsp.mkdir(folder,{recursive:true,mode:0o700});
 const encrypted=path.join(folder,job.id+'.eobackup'),output=path.join(folder,host.pdv.codigo+'-'+job.id+'.sqlite');
 const r=await fetch(base+'/api/desktop/remote-backup/jobs/'+job.id+'/download',{headers:{Authorization:'Bearer '+auth.token},signal:AbortSignal.timeout(600000)});
 if(!r.ok)throw Error('Falha no download: '+r.status);
 await pipeline(Readable.fromWeb(r.body),fs.createWriteStream(encrypted,{flags:'wx',mode:0o600}));
 if((await fsp.stat(encrypted)).size!==ready.size||await hash(encrypted)!==ready.sha256)throw Error('Download incompleto');
 const manifest=await decryptBackup(encrypted,keys.privateKey,output,job.id,String(host._id));
 await fsp.writeFile(output+'.json',JSON.stringify({...manifest,key:undefined,iv:undefined},null,2),{flag:'wx',mode:0o600});
 await fsp.rm(encrypted,{force:true});
 await api('/jobs/'+job.id+'/received',{sha256:ready.sha256}).catch(()=>console.log('A copia criptografada na API expirara automaticamente.'));
 console.log('BACKUP VERIFICADO: '+output);console.log('Data da copia: '+manifest.snapshotAt);
}
module.exports={decryptBackup};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
