import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const MASTER=Buffer.alloc(32,5);
const TOKEN='bot-token-ABC.secret.value';
const instances=[];after(async()=>{await Promise.all(instances.map(m=>m.dispose()));});

async function encrypt(value){
 const key=await crypto.subtle.importKey('raw',MASTER,{name:'AES-GCM'},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const text=typeof value==='string'?value:JSON.stringify(value);
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text));
 return JSON.stringify({v:1,iv:Buffer.from(iv).toString('base64'),ct:Buffer.from(ct).toString('base64')});
}
async function decrypt(packed){
 const {iv,ct}=JSON.parse(packed);
 const key=await crypto.subtle.importKey('raw',MASTER,{name:'AES-GCM'},false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(ct,'base64'));
 return new TextDecoder().decode(plain);
}

const manifest=provider=>({
 name:'test-bot',provider,runtime:'worker',
 setup:{fields:[
  {key:'DISCORD_BOT_TOKEN',label:'Token',type:'secret',required:true},
  {key:'DISCORD_APPLICATION_ID',label:'App ID',type:'text',required:true},
  {key:'LUCKYPANEL_API_KEY',label:'LuckyPanel',type:'secret',required:false},
  {key:'ENABLE_X',label:'X',type:'boolean',required:false}
 ]}
});

async function fixture(provider){
 const dispatches=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('src/index.js','utf8'),compatibilityDate:'2026-08-06',d1Databases:['DB'],
  bindings:{
   FACTORY_MASTER_KEY:MASTER.toString('base64'),FACTORY_SESSION_SECRET:'s'.repeat(40),FACTORY_ADMIN_PASSWORD:'pw',
   FACTORY_GITHUB_REPO:'owner/factory',FACTORY_GITHUB_REF:'main',ALLOWED_REPO_OWNER:'owner',MWS_API_BASE:'https://cloud.m-ws.cc/api'
  },
  outboundService:async req=>{
   const url=new URL(req.url);
   if(url.host==='api.github.com'&&url.pathname.endsWith('/contents/bot-factory.json')){
    return Response.json({content:Buffer.from(JSON.stringify(manifest(provider))).toString('base64'),encoding:'base64'});
   }
   if(url.host==='api.github.com'&&url.pathname.includes('/dispatches')){dispatches.push(url.pathname);return new Response(null,{status:204});}
   return new Response('mock: unavailable',{status:500});
  }}));
 instances.push(mf);
 const db=await mf.getD1Database('DB');
 const schema=await readFile('schema.sql','utf8');
 const statements=schema.split(/\n\s*\n/).map(chunk=>chunk.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
 for(const sql of statements) await db.prepare(sql).run();
 const now=new Date().toISOString();
 await db.prepare("INSERT INTO settings(key,encrypted_value,metadata_json,updated_at) VALUES('github_pat',?,?,?)").bind(await encrypt('ghp_test'),'{"login":"t"}',now).run();
 await db.prepare("INSERT INTO vps_accounts(alias,label,preset,host,port,username,auth_type,encrypted_secret,created_at,updated_at) VALUES('vps1','VPS','other','203.0.113.5',22,'root','password',?,?,?)").bind(await encrypt('pw'),now,now).run();
 await db.prepare("INSERT INTO mws_accounts(alias,label,encrypted_cookie,created_at,updated_at) VALUES('mws1','m-ws',?,?,?)").bind(await encrypt('cookie'),now,now).run();
 const login=await mf.dispatchFetch('https://factory.test/api/login',{method:'POST',body:JSON.stringify({password:'pw'})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const call=(path,init={})=>mf.dispatchFetch('https://factory.test'+path,{...init,headers:{cookie,...(init.headers||{})}});
 return {mf,db,call,dispatches};
}

const launch=(f,account,extra={})=>f.call('/api/deployments',{method:'POST',body:JSON.stringify({
 repository:'owner/test-bot',ref:'main',account_alias:account,confirmed_requirements:[],...extra
})});

test('VPS: entered values are saved, shown as restorable, and reused without retyping secrets',async()=>{
 const f=await fixture('vps');
 const first=await launch(f,'vps1',{fields:{DISCORD_BOT_TOKEN:TOKEN,DISCORD_APPLICATION_ID:'123456789012345678',LUCKYPANEL_API_KEY:'lp-key',ENABLE_X:true}});
 assert.equal(first.status,200,await first.clone().text());
 const {deployment}=await first.json();
 await f.db.prepare("UPDATE deployments SET status='completed',conclusion='success' WHERE id=?").bind(deployment.id).run();

 const historyRes=await f.call('/api/deployments');
 assert.equal(historyRes.status,200,'the history list itself must load');
 const history=await historyRes.json();
 assert.equal(history.deployments.find(row=>row.id===deployment.id).can_restart,1,'the 設定を復元 button must be offered');

 const restoreRes=await f.call('/api/deployments/'+deployment.id+'/restore');
 const restoreText=await restoreRes.text();
 assert.equal(restoreRes.status,200,restoreText);
 const {restore}=JSON.parse(restoreText);
 assert.equal(restore.fields.DISCORD_APPLICATION_ID,'123456789012345678');
 assert.deepEqual(restore.saved_secret_keys.sort(),['DISCORD_BOT_TOKEN','LUCKYPANEL_API_KEY']);
 assert.equal(restoreText.includes(TOKEN),false,'secret values are never sent back to the browser');
 assert.equal(restore.missing_required_field_keys.length,0);

 const second=await launch(f,'vps1',{restore_from_deployment_id:deployment.id,fields:{DISCORD_APPLICATION_ID:'123456789012345678'}});
 assert.equal(second.status,200,await second.clone().text());
 const next=(await second.json()).deployment;
 const row=await f.db.prepare('SELECT encrypted_payload FROM deployments WHERE id=?').bind(next.id).first();
 const payload=JSON.parse(await decrypt(row.encrypted_payload));
 assert.equal(payload.env.DISCORD_BOT_TOKEN,TOKEN,'blank secret fields fall back to the saved value');
 assert.equal(payload.env.LUCKYPANEL_API_KEY,'lp-key');
 assert.equal(f.dispatches.length,2);
});

test('VPS: a failed deploy attempt still keeps what the user typed',async()=>{
 const f=await fixture('vps');
 const bad=await launch(f,'vps1',{fields:{DISCORD_BOT_TOKEN:TOKEN,DISCORD_APPLICATION_ID:'123456789012345678'},confirmed_requirements:[]});
 assert.equal(bad.status,200);
 const row=await f.db.prepare('SELECT COUNT(*) AS n FROM deployment_profiles').first();
 assert.equal(row.n,1);
});

test('VPS: invalid input does not overwrite an existing saved profile',async()=>{
 const f=await fixture('vps');
 await launch(f,'vps1',{fields:{DISCORD_BOT_TOKEN:TOKEN,DISCORD_APPLICATION_ID:'111111111111111111'}});
 const rejected=await launch(f,'vps1',{fields:{DISCORD_APPLICATION_ID:'222222222222222222'}});
 assert.equal(rejected.status,400,'a missing required secret is rejected');
 const saved=await f.db.prepare('SELECT encrypted_inputs FROM deployment_profiles').first();
 assert.equal(JSON.parse(await decrypt(saved.encrypted_inputs)).fields.DISCORD_APPLICATION_ID,'111111111111111111');
});

test('restore is refused for a different repository account pair',async()=>{
 const f=await fixture('vps');
 const first=await launch(f,'vps1',{fields:{DISCORD_BOT_TOKEN:TOKEN,DISCORD_APPLICATION_ID:'123456789012345678'}});
 const {deployment}=await first.json();
 const other=await launch(f,'mws1',{restore_from_deployment_id:deployment.id,fields:{}});
 assert.equal(other.status,400);
 assert.match((await other.json()).error,/一致しません/);
});

test('m-ws: values are saved even when the hosting call fails, and restore finds the m-ws history row',async()=>{
 const f=await fixture('mws');
 const res=await launch(f,'mws1',{fields:{DISCORD_BOT_TOKEN:TOKEN,DISCORD_APPLICATION_ID:'123456789012345678'}});
 assert.equal(res.status,400,'the mocked m-ws API is unavailable');
 const profile=await f.db.prepare('SELECT COUNT(*) AS n FROM deployment_profiles').first();
 assert.equal(profile.n,1);
 const row=await f.db.prepare('SELECT id FROM mws_deployments').first();
 const history=await (await f.call('/api/deployments')).json();
 assert.equal(history.deployments.find(item=>item.id===row.id).can_restart,1);
 const restore=await f.call('/api/deployments/'+row.id+'/restore');
 const text=await restore.text();
 assert.equal(restore.status,200,text);
 const body=JSON.parse(text).restore;
 assert.equal(body.fields.DISCORD_APPLICATION_ID,'123456789012345678');
 assert.deepEqual(body.saved_secret_keys,['DISCORD_BOT_TOKEN']);
});

test('history lists Cloudflare/VPS and m-ws deployments together, newest first',async()=>{
 const f=await fixture('vps');
 const now=Date.now();
 const iso=offset=>new Date(now+offset).toISOString();
 await f.db.prepare("INSERT INTO deployments(id,repository,ref,worker_name,account_alias,encrypted_payload,status,created_at,expires_at) VALUES('older','owner/test-bot','main','test-bot','vps1','','completed',?,?)").bind(iso(-5000),iso(60000)).run();
 await f.db.prepare("INSERT INTO mws_deployments(id,repository,ref,bot_name,account_alias,status,created_at) VALUES('newer','owner/test-bot','main','test-bot','mws1','completed',?)").bind(iso(-1000)).run();
 const res=await f.call('/api/deployments');
 assert.equal(res.status,200);
 const {deployments}=await res.json();
 assert.deepEqual(deployments.map(row=>row.id),['newer','older']);
 assert.deepEqual(deployments.map(row=>row.provider),['mws','vps']);
});
