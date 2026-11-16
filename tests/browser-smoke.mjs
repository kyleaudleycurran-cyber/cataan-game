import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory=await mkdtemp(join(tmpdir(),'cataan-browser-'));
const port=3478,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
const exited=new Promise(resolve=>server.once('exit',resolve));
let output='';server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
let browser;
try{
  let ready=false;
  for(let i=0;i<100;i++){try{ready=(await fetch(base+'/api/health')).ok;if(ready)break;}catch{}await delay(100);}
  assert.ok(ready,'Server did not start: '+output);
  browser=await chromium.launch({headless:true});
  const contextA=await browser.newContext({viewport:{width:1440,height:1000}});
  const contextB=await browser.newContext({viewport:{width:1100,height:900}});
  const a=await contextA.newPage(),b=await contextB.newPage(),errors=[];
  for(const page of [a,b])page.on('pageerror',error=>errors.push(error.message));
  await a.goto(base);await a.locator('#player-name').fill('Alice');await a.locator('#create-button').click();
  await a.locator('#game').waitFor({state:'visible'});
  const room=await a.evaluate(()=>new URLSearchParams(location.search).get('room'));
  assert.match(room,/^[A-Z2-9]{8}$/);
  await a.locator('#rules-button').click();await a.locator('#rule-target').fill('12');await a.locator('#renovation-brick').fill('2');
  await a.getByRole('button',{name:'Save house rules',exact:true}).click();await a.locator('#rules-dialog').waitFor({state:'hidden'});
  await b.goto(base+'/?room='+room);await b.locator('#player-name').fill('Bob');await b.getByRole('button',{name:'Join table',exact:true}).click();
  await b.locator('#game').waitFor({state:'visible'});
  await a.waitForFunction(()=>document.getElementById('player-count').textContent==='2/4');
  await a.locator('[data-action="start"]').click();
  async function state(page){
    return page.evaluate(async()=>{
      const room=new URLSearchParams(location.search).get('room'),seat=JSON.parse(localStorage.getItem('cataan_seats_v1'))[room];
      return (await (await fetch('/api/rooms/'+room,{headers:{Authorization:'Bearer '+seat.token}})).json()).game;
    });
  }
  let view;
  for(let step=0;step<8;step++){
    for(let i=0;i<50;i++){view=await state(a);if(view.phase.startsWith('setup'))break;await delay(100);}
    assert.ok(view.phase.startsWith('setup'));
    const page=view.current==='p1'?a:b;
    const selector=view.phase==='setup-settlement'?'#board [data-node]':'#board [data-edge]';
    await page.locator(selector).first().waitFor({state:'visible'});
    const revision=view.revision;await page.locator(selector).first().click();
    for(let i=0;i<50;i++){if((await state(a)).revision>revision)break;await delay(100);}
  }
  view=await state(a);assert.equal(view.phase,'roll');assert.equal(view.rules.targetPoints,12);assert.equal(view.rules.renovationCost.brick,2);
  await a.locator('#offer-button').click();
  await a.locator('[data-add-future="give"]').click();await a.locator('#give-futures select').selectOption('grain');
  await a.locator('[data-add-future="want"]').click();await a.locator('#want-futures select').selectOption('ore');
  await a.locator('#want-futures [data-field="start"]').fill('3');await a.locator('#want-futures [data-field="count"]').fill('2');
  await a.getByRole('button',{name:'Post offer',exact:true}).click();
  await a.locator('#trade-dialog').waitFor({state:'hidden'});
  await b.getByRole('button',{name:'Accept',exact:true}).click();
  for(let i=0;i<50;i++){view=await state(a);if(view.claims.length===3)break;await delay(100);}
  assert.equal(view.claims.length,3);
  await a.waitForFunction(()=>document.getElementById('futures').textContent.includes('Alice'));
  await mkdir('test-artifacts',{recursive:true});
  await a.screenshot({path:'test-artifacts/table-desktop.png',fullPage:true});
  await a.setViewportSize({width:390,height:844});await a.screenshot({path:'test-artifacts/table-mobile.png',fullPage:true});
  const overflow=await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,'Mobile layout must fit the viewport.');
  await a.reload();await a.locator('#game').waitFor({state:'visible'});assert.equal((await state(a)).claims.length,3);
  assert.deepEqual(errors,[]);
  console.log('Browser smoke passed: two seats, rule editing, setup, off-turn futures, mobile fit, and reconnect.');
}finally{
  if(browser)await browser.close();
  if(server.exitCode===null)server.kill('SIGTERM');
  await exited;await rm(directory,{recursive:true,force:true});
}
