import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { seeded } from './helpers.mjs';

test('multiplayer API enforces seats, privacy, revisions, turns, and durable reconnects',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'cataan-test-'));
  let server=await createServer({dataDirectory:directory,random:seeded()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  async function request(path,{secret,data,origin}={}){
    const response=await fetch(base+path,{method:data?'POST':'GET',headers:{...(secret?{Authorization:'Bearer '+secret}:{}),...(data?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})},body:data?JSON.stringify(data):undefined});
    return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
  }
  assert.equal((await request('/api/health')).status,200);
  const created=await request('/api/rooms',{data:{name:'Alice'}});
  assert.equal(created.status,201);const a=created.data,room='/api/rooms/'+a.room;
  const joined=await request(room+'/join',{data:{name:'Bob'}});assert.equal(joined.status,201);const b=joined.data;
  assert.equal((await request(room)).status,401);
  assert.equal((await request(room,{secret:'invalid'})).status,401);
  let current=await request(room,{secret:a.token});
  assert.ok(current.headers.get('content-security-policy'));
  assert.equal(current.data.game.players[1].resources,undefined);
  assert.equal(current.data.game.players[1].dev,undefined);
  const stale=await request(room+'/actions',{secret:a.token,data:{revision:0,action:{type:'start'}}});
  assert.equal(stale.status,409);assert.equal(stale.data.game.phase,'lobby');
  const crossOrigin=await request(room+'/actions',{secret:a.token,origin:'https://example.invalid',data:{revision:1,action:{type:'start'}}});
  assert.equal(crossOrigin.status,403);
  const tokens={p1:a.token,p2:b.token};
  async function action(id,action){
    const view=await request(room,{secret:tokens[id]});
    return request(room+'/actions',{secret:tokens[id],data:{revision:view.data.game.revision,action}});
  }
  let result=await action('p1',{type:'start'});assert.equal(result.status,200);
  assert.equal((await request(room+'/join',{data:{name:'Third'}})).status,400);
  while(result.data.game.phase.startsWith('setup')){
    const id=result.data.game.current;
    const view=(await request(room,{secret:tokens[id]})).data.game;
    result=await action(id,view.phase==='setup-settlement'?{type:'settlement',node:view.legal.settlements[0]}:{type:'road',edge:view.legal.roads[0]});
    assert.equal(result.status,200);
  }
  assert.equal(result.data.game.phase,'roll');
  assert.equal((await action('p2',{type:'roll'})).status,400);
  current=await request(room,{secret:a.token});const revision=current.data.game.revision;
  assert.equal((await request(room+'?since='+revision,{secret:a.token})).status,204);
  assert.equal((await request('/server.mjs')).status,404);
  const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(await html.text(),/House Table/);
  await new Promise(resolve=>server.close(resolve));
  server=await createServer({dataDirectory:directory,random:seeded()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
  const resumed=await request(room,{secret:a.token});
  assert.equal(resumed.status,200);assert.equal(resumed.data.game.revision,revision);assert.equal(resumed.data.game.phase,'roll');
});
