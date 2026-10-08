const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const Job = require('../models/PdvRemoteBackup');
const Host = require('../models/PdvDesktopHost');
const configPath = process.env.PDV_REMOTE_BACKUP_CONFIG || path.join(process.env.LOCALAPPDATA || os.homedir(), 'EoBichoServer', 'remote-backup.json');
const root = process.env.PDV_REMOTE_BACKUP_DIR || path.join(path.dirname(configPath), 'encrypted-backups');
const locks = new Set();
function allowedIds() { try { const c = JSON.parse(fs.readFileSync(configPath,'utf8')); return c.enabled === true && Array.isArray(c.adminIds) ? c.adminIds : []; } catch { return []; } }
function allowed(req) { return ['admin','admin_master'].includes(req.user?.originalRole || req.user?.role) && allowedIds().includes(String(req.user?.id)); }
function file(id) { if (!/^[a-f0-9]{24}$/.test(String(id))) throw Error('Invalid backup ID'); return path.join(root, String(id) + '.eobackup'); }
async function digest(filename) { const h=crypto.createHash('sha256'); for await(const b of fs.createReadStream(filename)) h.update(b); return h.digest('hex'); }
async function cleanup() {
  const expired = await Job.find({ expiresAt: { $lte: new Date() }, status: { $ne: 'expired' } }).select('_id').lean();
  for (const job of expired) {
    if (locks.has(String(job._id))) continue;
    await fsp.rm(file(job._id),{force:true});
    await Job.updateOne({_id:job._id},{$set:{status:'expired',active:false,publicKey:''}});
  }
}
async function claim(host, capable, busy) {
  if (!capable || busy || !allowedIds().length) return null;
  const job=await Job.findOneAndUpdate({host:host._id,status:'pending',expiresAt:{$gt:new Date()},requestedBy:{$in:allowedIds()}},{$set:{status:'generating'}},{new:true}).lean();
  return job ? {id:String(job._id),hostId:String(host._id),publicKey:job.publicKey,expiresAt:job.expiresAt} : null;
}
function register(router, requireAuth, authenticateHost) {
  const wrap = fn => (req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const admin = (req,res,next)=>allowed(req)?next():res.status(403).json({message:'Backup remoto nao autorizado para esta conta.'});
  router.get('/remote-backup/hosts',requireAuth,admin,wrap(async(req,res)=>{
    const hosts=await Host.find({status:'active'}).select('_id pdv empresa name appVersion lastHeartbeatAt remoteBackupVersion').populate('empresa','nome nomeFantasia razaoSocial').populate('pdv','nome codigo').lean();
    res.json({hosts});
  }));
  router.post('/remote-backup/jobs',requireAuth,admin,wrap(async(req,res)=>{
    await cleanup();
    if(!/^[a-f0-9]{24}$/.test(String(req.body.hostId||''))||String(req.body.publicKey||'').length>4096)return res.sendStatus(400);
    if(await Job.countDocuments({requestedBy:req.user.id,createdAt:{$gte:new Date(Date.now()-3600000)}})>=6)return res.status(429).json({message:'Limite de 6 solicitacoes por hora.'});
    const host=await Host.findOne({_id:req.body.hostId,status:'active',remoteBackupVersion:1});
    if(!host)return res.status(409).json({message:'Servidor nao atualizado ou indisponivel.'});
    if(Date.now()-new Date(host.lastHeartbeatAt).getTime()>180000)return res.status(409).json({message:'Servidor da loja esta offline.'});
    let key;
    try{key=crypto.createPublicKey(String(req.body.publicKey||''));}catch{return res.status(400).json({message:'Chave publica invalida.'});}
    if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048||key.asymmetricKeyDetails.modulusLength>4096)return res.status(400).json({message:'Chave RSA invalida.'});
    if(await Job.countDocuments({requestedBy:req.user.id,active:true})>=2)return res.status(429).json({message:'Aguarde os backups atuais.'});
    try{
      const job=await Job.create({host:host._id,requestedBy:req.user.id,publicKey:key.export({type:'spki',format:'pem'}),expiresAt:new Date(Date.now()+3600000)});
      res.status(201).json({id:job.id,expiresAt:job.expiresAt});
    }catch(e){if(e.code===11000)return res.status(409).json({message:'Ja existe backup ativo para este servidor.'});throw e;}
  }));
  const ownJob=async(req,res)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id)){res.sendStatus(404);return null;}
    const job=await Job.findOne({_id:req.params.id,requestedBy:req.user.id,expiresAt:{$gt:new Date()}});
    if(!job)res.sendStatus(404);return job;
  };
  router.get('/remote-backup/jobs/:id',requireAuth,admin,wrap(async(req,res)=>{
    const job=await ownJob(req,res);if(job)res.json({id:job.id,hostId:String(job.host),status:job.status,size:job.size,sha256:job.sha256,expiresAt:job.expiresAt});
  }));
  router.get('/remote-backup/jobs/:id/download',requireAuth,admin,wrap(async(req,res)=>{
    const job=await ownJob(req,res);if(!job)return;
    if(job.status!=='ready')return res.sendStatus(409);
    res.set({'Cache-Control':'no-store','Content-Type':'application/octet-stream','Content-Length':String(job.size)});
    res.download(file(job.id),job.id+'.eobackup',err=>{if(err&&!res.headersSent)res.status(500).end();});
  }));
  router.post('/remote-backup/jobs/:id/received',requireAuth,admin,wrap(async(req,res)=>{
    const job=await ownJob(req,res);if(!job)return;
    if(job.status!=='ready'||req.body.sha256!==job.sha256)return res.sendStatus(409);
    await fsp.rm(file(job.id),{force:true});job.status='downloaded';job.active=false;job.downloadedAt=new Date();await job.save();res.json({ok:true});
  }));
  const hostJob=async(req,res)=>{
    if(!allowedIds().length || !/^[a-f0-9]{24}$/.test(req.params.id)){res.sendStatus(404);return null;}
    const job=await Job.findOne({_id:req.params.id,host:req.desktopHost._id,status:'generating',expiresAt:{$gt:new Date()},requestedBy:{$in:allowedIds()}});
    if(!job)res.sendStatus(404);return job;
  };
  router.post('/remote-backup/host/:id/chunk',authenticateHost,express.raw({type:'application/octet-stream',limit:'1mb'}),wrap(async(req,res)=>{
    const job=await hostJob(req,res);if(!job)return;
    if(locks.has(job.id))return res.sendStatus(409);
    locks.add(job.id);
    try{
      const offset=Number(req.query.offset),data=req.body;
      if(!Number.isSafeInteger(offset)||offset<0||!Buffer.isBuffer(data)||!data.length||offset+data.length>1024**3)return res.sendStatus(400);
      await fsp.mkdir(root,{recursive:true,mode:0o700});
      const current=await fsp.stat(file(job.id)).catch(e=>{if(e.code==='ENOENT')return {size:0};throw e;});
      if(current.size!==offset)return res.sendStatus(409);
      await fsp.appendFile(file(job.id),data,{mode:0o600});res.json({offset:offset+data.length});
    }finally{locks.delete(job.id);}
  }));
  router.post('/remote-backup/host/:id/complete',authenticateHost,wrap(async(req,res)=>{
    const job=await hostJob(req,res);if(!job)return;
    if(locks.has(job.id))return res.sendStatus(409);locks.add(job.id);
    try{
      const stat=await fsp.stat(file(job.id));const sha=await digest(file(job.id));
      if(stat.size!==req.body.size||sha!==req.body.sha256)return res.sendStatus(400);
      job.size=stat.size;job.sha256=sha;job.status='ready';await job.save();res.json({ok:true});
    }finally{locks.delete(job.id);}
  }));
  router.post('/remote-backup/host/:id/fail',authenticateHost,wrap(async(req,res)=>{
    const job=await hostJob(req,res);if(!job)return;
    if(locks.has(job.id))return res.sendStatus(409);
    await fsp.rm(file(job.id),{force:true});job.status='failed';job.active=false;await job.save();res.json({ok:true});
  }));
  void cleanup().catch(()=>{});
  const timer=setInterval(()=>cleanup().catch(()=>{}),60000);timer.unref();
}
module.exports={register,claim,cleanup};
