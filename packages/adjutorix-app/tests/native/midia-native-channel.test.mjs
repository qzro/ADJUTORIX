/** Test the REAL MIDIA framing protocol with a local fake gateway. No secret output. */
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,lstatSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const compiled=process.argv[2];
if (!compiled) throw new Error('COMPILED_NATIVE_LINK_REQUIRED');
const {MidiaNativeClient,NativeLinkRefused,registerMidiaNativeIpc}=await import(pathToFileURL(path.resolve(compiled)).href);
const version='midia.desktop.channel.v1';
const nonceId='s_'+'a'.repeat(48);
const key=randomBytes(32);
const original=Object.getOwnPropertyDescriptor(process,'platform');
Object.defineProperty(process,'platform',{...original,value:'darwin'});
// Keep the pathname below macOS's AF_UNIX sun_path limit.
const home=mkdtempSync('/tmp/midia-native-');
const state=path.join(home,'.midia-ai','gateway-live');
const desktop=path.join(state,'desktop');
for (const p of [path.join(home,'.midia-ai'),state,desktop]) mkdirSync(p,{mode:0o700});
const socketPath=path.join(desktop,'channel.sock');
const dataPath=path.join(desktop,'channel.json');
const material=(kind,nonce,issued,body)=>[version,kind,nonce,String(issued),body].join('\n');
const hmac=(kind,nonce,issued,body)=>createHmac('sha256',key).update(material(kind,nonce,issued,body),'ascii').digest('hex');
let badMac=false;
const requests=[];
const server=createServer(sock=>{
  let input='';
  sock.on('data',chunk=>{
    input+=chunk.toString('utf8');
    if (!input.includes('\n')) return;
    const msg=JSON.parse(input.slice(0,input.indexOf('\n')));
    assert.equal(msg.mac,hmac('request',msg.nonce,msg.issued_at,msg.body));
    const request=JSON.parse(Buffer.from(msg.body,'base64').toString('utf8'));
    requests.push(request.method);
    const result=request.method==='health'?{service:'MIDIA-AI',transport:'owner-authenticated-local-channel',source_grants:[{project_id:'adjutorix',state:'ACTIVE'}]}:
      request.method==='presentations'?{presentations:[{event_id:'event_'+'b'.repeat(48),state:'PENDING',binding:{session_id:nonceId,project:'adjutorix'}}]}:
      request.method==='bind_view'?{view_id:'view_'+'c'.repeat(48),project:'adjutorix'}:
      request.method==='listing'?{entries:[{path:'README.md'}]}:
      request.method==='read'?{text:'# Source',source_sha256:'0'.repeat(64),head:'a'.repeat(40)}:
      request.method==='work_items'?{work_items:[]} : {};
    const body=Buffer.from(JSON.stringify({ok:true,result})).toString('base64');
    const response={version,nonce:msg.nonce,issued_at:msg.issued_at,body,mac:badMac?'0'.repeat(64):hmac('response',msg.nonce,msg.issued_at,body)};
    sock.end(JSON.stringify(response)+'\n');
  });
});
try {
  await new Promise((resolve,reject)=>server.listen(socketPath,()=>resolve()).on('error',reject));
  chmodSync(socketPath,0o600);
  const identity=lstatSync(socketPath);
  writeFileSync(dataPath,JSON.stringify({schema:version,socket_path:socketPath,socket_identity:[identity.dev,identity.ino],key_hex:key.toString('hex'),principal:'local-owner:test',scope_binding:'b'.repeat(64)}),{mode:0o600});
  const link=new MidiaNativeClient(state,home);
  const health=await link.status();
  assert.equal(health.connected,true);
  assert.equal(health.execution_authorized,false);
  assert.equal(health.native_chat_identity_attested,false);
  assert.deepEqual(await link.presentations(),{presentations:[{event_id:'event_'+'b'.repeat(48),state:'PENDING',session_id:nonceId,project:'adjutorix'}]});
  await assert.rejects(link.bind('s_'+'d'.repeat(48)),/DESKTOP_SESSION_NOT_PRESENTED/);
  const bound=await link.bind(nonceId);
  assert.equal(bound.view_id,'view_'+'c'.repeat(48));
  assert.equal((await link.listing(bound.view_id)).result.entries[0].path,'README.md');
  assert.equal((await link.read(bound.view_id,'README.md')).text,'# Source');
  assert.deepEqual((await link.workItems()).items,[]);
  const handlers=new Map();
  registerMidiaNativeIpc({handle:(name,fn)=>handlers.set(name,fn)});
  assert.deepEqual([...handlers.keys()].sort(),[
    'adjutorix:midia:status','adjutorix:midia:presentations','adjutorix:midia:bind',
    'adjutorix:midia:listing','adjutorix:midia:read','adjutorix:midia:workItems'].sort());
  // IPC uses the fixed HOME in a real Electron process; no raw key method exists.
  assert.equal(handlers.has('adjutorix:midia:execute'),false);
  badMac=true;
  await assert.rejects(link.status(),/DESKTOP_RESPONSE_AUTHENTICATION_DENIED/);
  badMac=false;
  // Identity of a swapped socket is rejected before any request.
  writeFileSync(dataPath,JSON.stringify({schema:version,socket_path:socketPath,socket_identity:[identity.dev,identity.ino+1],key_hex:key.toString('hex'),principal:'local-owner:test',scope_binding:'b'.repeat(64)}),{mode:0o600});
  await assert.rejects(link.status(),/DESKTOP_SOCKET_IDENTITY_INVALID/);
  rmSync(dataPath);
  symlinkSync(socketPath,dataPath);
  await assert.rejects(link.status());
  assert.ok(requests.length>=7);
  console.log('MIDIA_NATIVE_CLIENT_PROTOCOL_TESTS=PASS');
} finally {
  await new Promise(resolve=>server.close(()=>resolve()));
  rmSync(home,{recursive:true,force:true});
  Object.defineProperty(process,'platform',original);
}
