import { createGame, addPlayer, applyAction, viewGame, activeId } from '../src/game.mjs';
import { emptyCards } from '../src/rules.mjs';
import { credit } from '../src/market.mjs';
export function seeded(seed=831) {return()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646;};}
export function setup(count=2,rules={}) {
  let s=createGame('a','Alice',rules,seeded());
  for(let i=1;i<count;i++)s=addPlayer(s,['a','b','c','d'][i],['Alice','Bob','Cleo','Dev'][i]);
  s=applyAction(s,'a',{type:'start'});
  while(s.phase.startsWith('setup')){
    const id=activeId(s),v=viewGame(s,id);
    s=applyAction(s,id,s.phase==='setup-settlement'?{type:'settlement',node:v.legal.settlements[0]}:{type:'road',edge:v.legal.roads[0]});
  }
  return s;
}
export function cleanHands(s) {
  for(const p of s.players){p.resources=emptyCards();p.receipts=emptyCards();p.dev=[];}
  s.bank=Object.fromEntries(Object.keys(s.bank).map(r=>[r,19]));s.claims=[];s.offers=[];return s;
}
export function grant(s,id,r,count) {s.bank[r]-=count;credit(s,id,r,count,'test supply');}
export function claim(s,debtor,beneficiary,resource,offset=1) {
  s.claims.push({id:s.nextClaim++,debtor,beneficiary,resource,due:s.players.find(p=>p.id===debtor).receipts[resource]+offset});
}
export function quantity(s,r) {return s.bank[r]+s.players.reduce((n,p)=>n+p.resources[r],0);}
