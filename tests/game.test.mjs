import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, applyAction, viewGame, activeId, points } from '../src/game.mjs';
import { makeBoard, longestRoad, moveRoadLegal, otherNode } from '../src/board.mjs';
import { validateRules, RESOURCES } from '../src/rules.mjs';
import { credit } from '../src/market.mjs';
import { setup, seeded, cleanHands, grant, claim, quantity } from './helpers.mjs';

test('island has standard topology, terrain, ports, and separated red numbers',()=>{
  const b=makeBoard(seeded());
  assert.equal(b.tiles.length,19);assert.equal(b.nodes.length,54);assert.equal(b.edges.length,72);assert.equal(b.ports.length,9);
  assert.equal(b.tiles.filter(t=>t.resource==='desert').length,1);
  for(const t of b.tiles.filter(t=>[6,8].includes(t.number)))
    for(const u of b.tiles.filter(u=>u.id!==t.id&&[6,8].includes(u.number)))
      assert.ok(Math.max(Math.abs(t.q-u.q),Math.abs(t.r-u.r),Math.abs(t.q+t.r-u.q-u.r))>1);
});
test('two through four players complete snake setup and receive second-placement resources',()=>{
  for(const count of [2,3,4]){
    const s=setup(count);
    assert.equal(s.phase,'roll');assert.equal(activeId(s),'a');
    for(const p of s.players){assert.equal(points(s,p.id),2);assert.equal(s.board.edges.filter(e=>e.owner===p.id).length,2);}
    for(const r of RESOURCES)assert.equal(quantity(s,r),19);
  }
});
test('only the host edits valid rule packs in the lobby',()=>{
  let s=createGame('a','Alice',{},seeded());s=addPlayer(s,'b','Bob');
  assert.throws(()=>applyAction(s,'b',{type:'rules',rules:{targetPoints:15}}),/host/);
  s=applyAction(s,'a',{type:'rules',rules:{targetPoints:15,renovationCost:{ore:2}}});
  assert.equal(s.rules.targetPoints,15);assert.equal(s.rules.renovationCost.ore,2);
  assert.throws(()=>validateRules({targetPoints:1}));assert.throws(()=>validateRules({arbitrary:true}));
  assert.throws(()=>validateRules(JSON.parse('{"constructor":1}')));
  assert.throws(()=>applyAction(setup(),'a',{type:'rules',rules:{}}),/host/);
});
test('turn restrictions and illegal actions leave the original state untouched',()=>{
  const s=setup(),before=structuredClone(s);
  assert.throws(()=>applyAction(s,'b',{type:'roll'}),/time to roll/);
  assert.throws(()=>applyAction(s,'a',{type:'settlement',node:0}),/cannot place/);
  assert.deepEqual(s,before);
});
test('one wheat now buys the next two incoming wheats after acceptance',()=>{
  let s=cleanHands(setup());grant(s,'a','grain',1);
  s=applyAction(s,'a',{type:'offer',to:'b',give:{cards:{grain:1}},want:{futures:[{resource:'grain',start:1,count:2}]}});
  s=applyAction(s,'b',{type:'accept',offer:1});
  assert.equal(s.players[1].resources.grain,1);assert.equal(s.players[0].resources.grain,0);assert.equal(s.claims.length,2);
  grant(s,'b','grain',2);
  assert.equal(s.players[0].resources.grain,2);assert.equal(s.players[1].resources.grain,1);assert.equal(s.claims.length,0);
  assert.equal(quantity(s,'grain'),19);
});
test('later futures skip earlier arrivals',()=>{
  const s=cleanHands(setup());claim(s,'b','a','grain',3);
  grant(s,'b','grain',2);assert.equal(s.players[1].resources.grain,2);assert.equal(s.claims.length,1);
  grant(s,'b','grain',1);assert.equal(s.players[0].resources.grain,1);assert.equal(s.claims.length,0);assert.equal(quantity(s,'grain'),19);
});
test('the same future delivery cannot be promised twice; failed acceptance rolls back cash',()=>{
  let s=cleanHands(setup());grant(s,'a','wood',2);claim(s,'b','a','grain');
  s=applyAction(s,'a',{type:'offer',to:'b',give:{cards:{wood:1}},want:{futures:[{resource:'grain',start:1,count:1}]}});
  const before=structuredClone(s);
  assert.throws(()=>applyAction(s,'b',{type:'accept',offer:1}),/already promised/);
  assert.deepEqual(s,before);
});
test('existing claims apply to immediate trade payments before new futures activate',()=>{
  let s=cleanHands(setup(3));grant(s,'a','grain',1);claim(s,'b','c','grain');
  s=applyAction(s,'a',{type:'offer',to:'b',give:{cards:{grain:1}},want:{futures:[{resource:'wood',start:1,count:1}]}});
  s=applyAction(s,'b',{type:'accept',offer:1});
  assert.equal(s.players[1].resources.grain,0);assert.equal(s.players[2].resources.grain,1);
  assert.equal(s.claims.length,1);assert.equal(s.claims[0].resource,'wood');
});
test('chained and circular obligations settle once per claim without copying a card',()=>{
  const s=cleanHands(setup(3));claim(s,'a','b','grain');claim(s,'b','c','grain');claim(s,'c','a','grain');
  grant(s,'a','grain',1);
  assert.equal(s.claims.length,0);assert.equal(s.players[0].resources.grain,1);
  assert.equal(s.players.reduce((n,p)=>n+p.resources.grain,0),1);assert.equal(quantity(s,'grain'),19);
});
test('two inactive players trade on another player’s turn and offers survive turn changes',()=>{
  let s=cleanHands(setup(3));s.current=2;s.phase='build';grant(s,'a','wood',1);grant(s,'b','brick',1);
  s=applyAction(s,'a',{type:'offer',to:'b',give:{cards:{wood:1}},want:{cards:{brick:1}}});
  s=applyAction(s,'c',{type:'end'});assert.equal(s.offers.length,1);
  s.current=2;s.phase='roll';s=applyAction(s,'b',{type:'accept',offer:1});
  assert.equal(s.players[0].resources.brick,1);assert.equal(s.players[1].resources.wood,1);
});
test('restricted trading still allows an inactive recipient to accept the active player’s offer',()=>{
  let s=cleanHands(setup(3,{tradeOnAnyTurn:false}));grant(s,'a','wood',1);grant(s,'b','brick',1);
  s=applyAction(s,'a',{type:'offer',to:'b',give:{cards:{wood:1}},want:{cards:{brick:1}}});
  s=applyAction(s,'b',{type:'accept',offer:1});assert.equal(s.players[0].resources.brick,1);
  assert.throws(()=>applyAction(s,'b',{type:'offer',to:'c',give:{futures:[{resource:'wood',start:1,count:1}]},want:{cards:{brick:1}}}),/active player/);
});
test('bank receipts settle futures and preserve resource supply',()=>{
  let s=cleanHands(setup());s.phase='build';grant(s,'a','wood',4);claim(s,'a','b','grain');
  s=applyAction(s,'a',{type:'bank',give:'wood',receive:'grain',count:1});
  assert.equal(s.players[0].resources.grain,0);assert.equal(s.players[1].resources.grain,1);
  for(const r of RESOURCES)assert.equal(quantity(s,r),19);
});
test('theft receipts settle futures, even when returning the card to its former holder',()=>{
  let s=cleanHands(setup());s.phase='steal';s.victims=['b'];grant(s,'b','grain',1);claim(s,'a','b','grain');
  s=applyAction(s,'a',{type:'steal',victim:'b'},()=>0);
  assert.equal(s.players[1].resources.grain,1);assert.equal(s.players[0].resources.grain,0);assert.equal(s.claims.length,0);assert.equal(quantity(s,'grain'),19);
});
test('dice production settles futures',()=>{
  let s=cleanHands(setup());const node=s.board.nodes.find(n=>n.owner==='a');
  const tile=s.board.tiles[node.tiles.find(id=>s.board.tiles[id].resource!=='desert')];
  for(const t of s.board.tiles)t.number=0;tile.number=6;
  claim(s,'a','b',tile.resource);
  const sequence=[1/6,3/6];s=applyAction(s,'a',{type:'roll'},()=>sequence.shift());
  assert.equal(s.claims.length,0);assert.ok(s.players[1].resources[tile.resource]>0);
  for(const r of RESOURCES)assert.equal(quantity(s,r),19);
});
test('monopoly and plenty route incoming cards through existing futures',()=>{
  let s=cleanHands(setup());s.phase='build';grant(s,'b','grain',2);claim(s,'a','b','grain');claim(s,'a','b','grain',2);
  s.players[0].dev=[{id:1,type:'monopoly',boughtOnTurn:0}];
  s=applyAction(s,'a',{type:'play-development',card:1,resource:'grain'});
  assert.equal(s.players[1].resources.grain,2);assert.equal(s.claims.length,0);assert.equal(quantity(s,'grain'),19);
  s.devPlayed=false;s.players[0].dev=[{id:2,type:'plenty',boughtOnTurn:0}];claim(s,'a','b','ore');
  s=applyAction(s,'a',{type:'play-development',card:2,resources:['ore','wood']});
  assert.equal(s.players[1].resources.ore,1);assert.equal(s.players[0].resources.wood,1);
  for(const r of RESOURCES)assert.equal(quantity(s,r),19);
});
test('development cards wait until a later turn and only one may be played per turn',()=>{
  let s=cleanHands(setup());s.phase='build';s.players[0].dev=[{id:1,type:'knight',boughtOnTurn:s.turn}];
  assert.throws(()=>applyAction(s,'a',{type:'play-development',card:1}),/previous turn/);
  s.players[0].dev[0].boughtOnTurn=0;s.devPlayed=true;
  assert.throws(()=>applyAction(s,'a',{type:'play-development',card:1}),/already played/);
});
test('a seven requires exact discards from every affected player before robber movement',()=>{
  let s=cleanHands(setup());grant(s,'a','grain',8);grant(s,'b','wood',8);
  const sequence=[0,.99];s=applyAction(s,'a',{type:'roll'},()=>sequence.shift());
  assert.equal(s.phase,'discard');assert.deepEqual(s.pendingDiscards,{a:4,b:4});
  assert.throws(()=>applyAction(s,'a',{type:'discard',cards:{grain:3}}),/exactly 4/);
  s=applyAction(s,'b',{type:'discard',cards:{wood:4}});assert.equal(s.phase,'discard');
  s=applyAction(s,'a',{type:'discard',cards:{grain:4}});assert.equal(s.phase,'robber');
});
test('private views do not expose other hands, development types, or hidden victory points',()=>{
  const s=setup();s.players[1].dev=[{id:1,type:'victory',boughtOnTurn:0}];
  const view=viewGame(s,'a'),other=view.players.find(p=>p.id==='b');
  assert.equal(other.resources,undefined);assert.equal(other.dev,undefined);assert.equal(other.score,2);
  assert.equal(view.deck,undefined);assert.equal(view.me.id,'a');assert.ok(view.me.resources);
});
function networkFixture() {
  const s=cleanHands(setup());s.phase='build';
  for(const n of s.board.nodes){n.owner=null;n.building=null;}for(const e of s.board.edges)e.owner=null;
  const n=s.board.nodes.find(n=>n.edges.length===3);n.owner='a';n.building='settlement';
  return {s,n};
}
test('road renovation charges its configured price and reuses the same road piece',()=>{
  let {s,n}=networkFixture();const [from,to]=n.edges;s.board.edges[from].owner='a';grant(s,'a','brick',1);
  assert.equal(moveRoadLegal(s,'a',from,to),true);
  s=applyAction(s,'a',{type:'move-road',from,to});
  assert.equal(s.board.edges[from].owner,null);assert.equal(s.board.edges[to].owner,'a');
  assert.equal(s.board.edges.filter(e=>e.owner==='a').length,1);assert.equal(s.players[0].resources.brick,0);assert.equal(quantity(s,'brick'),19);
});
test('renovation cannot disconnect previously connected roads and settlements',()=>{
  const {s,n}=networkFixture();
  const e1=s.board.edges[n.edges[0]],v1=otherNode(e1,n.id);
  const e2=s.board.edges[s.board.nodes[v1].edges.find(id=>id!==e1.id)],v2=otherNode(e2,v1);
  const e3=s.board.edges[s.board.nodes[v2].edges.find(id=>id!==e2.id)];
  for(const e of [e1,e2,e3])e.owner='a';
  assert.ok(s.board.edges.filter(e=>!e.owner).every(e=>!moveRoadLegal(s,'a',e2.id,e.id)));
});
test('longest road counts a continuous path and stops at an opponent settlement',()=>{
  const {s,n}=networkFixture();let current=n.id;const used=new Set(),nodes=[current];
  for(let i=0;i<5;i++){const e=s.board.edges[s.board.nodes[current].edges.find(id=>!used.has(id)&&!nodes.includes(otherNode(s.board.edges[id],current)))];used.add(e.id);e.owner='a';current=otherNode(e,current);nodes.push(current);}
  assert.equal(longestRoad(s,'a'),5);
  s.board.nodes[nodes[2]].owner='b';s.board.nodes[nodes[2]].building='settlement';assert.equal(longestRoad(s,'a'),3);
});
test('winning upgrade ends the game at the configured target',()=>{
  let s=cleanHands(setup(2,{targetPoints:3}));s.phase='build';grant(s,'a','grain',2);grant(s,'a','ore',3);
  const node=s.board.nodes.find(n=>n.owner==='a').id;s=applyAction(s,'a',{type:'city',node});
  assert.equal(s.winner,'a');assert.equal(s.phase,'finished');assert.equal(points(s,'a'),3);
  assert.throws(()=>applyAction(s,'a',{type:'end'}),/finished/);
});

test('a zero discard threshold does not wait for a zero-card discard',()=>{
  let s=cleanHands(setup(2,{discardLimit:0}));grant(s,'a','wood',1);
  const sequence=[0,.99];s=applyAction(s,'a',{type:'roll'},()=>sequence.shift());
  assert.equal(s.phase,'robber');assert.deepEqual(s.pendingDiscards,{});
});
