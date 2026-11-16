import { RESOURCES, emptyCards, checkedCards } from './rules.mjs';
export const totalCards = cards => RESOURCES.reduce((n,r)=>n+(cards[r]||0),0);
export function record(s, text) {
  s.log.push({ id: s.nextLog++, text });
  if(s.log.length>120)s.log.shift();
}
const name = (s,id) => s.players.find(p=>p.id===id)?.name || id;
export function credit(s, playerId, resource, amount, source='receipt') {
  if(!RESOURCES.includes(resource)||!Number.isSafeInteger(amount)||amount<0||amount>500)throw Error('Invalid resource receipt.');
  const players=new Map(s.players.map(p=>[p.id,p]));
  if(!players.has(playerId))throw Error('Unknown player.');
  for(let i=0;i<amount;i++) {
    let recipient=playerId;
    // Consume a claim before routing its card. Even a cycle can only consume
    // the finite set of existing claims; the physical card is never copied.
    while(true) {
      const p=players.get(recipient);
      const arrival=++p.receipts[resource];
      const index=s.claims.findIndex(c=>c.debtor===recipient&&c.resource===resource&&c.due===arrival);
      if(index===-1){p.resources[resource]++;break;}
      const [claim]=s.claims.splice(index,1);
      record(s,name(s,recipient)+' delivers 1 '+resource+' to '+name(s,claim.beneficiary)+' (future settled).');
      recipient=claim.beneficiary;
    }
  }
}
function checkedFutures(value=[]) {
  if(!Array.isArray(value)||value.length>5)throw Error('Too many future groups.');
  return value.map(f=>{
    if(!RESOURCES.includes(f.resource)||!Number.isInteger(f.start)||f.start<1||f.start>100||!Number.isInteger(f.count)||f.count<1||f.count>10||f.start+f.count-1>100)throw Error('Invalid future delivery range.');
    return {resource:f.resource,start:f.start,count:f.count};
  });
}
export function checkedLeg(value={}) {
  return {cards:checkedCards(value.cards||{},30),futures:checkedFutures(value.futures)};
}
export function hasLeg(leg) { return totalCards(leg.cards)>0 || leg.futures.length>0; }
export function settleTrade(s, offer) {
  const a=s.players.find(p=>p.id===offer.from), b=s.players.find(p=>p.id===offer.to);
  if(!a||!b||a===b)throw Error('Invalid trading partner.');
  const legs=[[a,b,checkedLeg(offer.give)],[b,a,checkedLeg(offer.want)]];
  if(!s.rules.futuresEnabled&&legs.some(x=>x[2].futures.length))throw Error('Futures are disabled.');
  if(!legs.every(x=>hasLeg(x[2])))throw Error('Both sides must offer something.');
  for(const [from,,leg]of legs)for(const r of RESOURCES)if(from.resources[r]<leg.cards[r])throw Error(from.name+' no longer has the offered resources.');
  // Debit every immediate payment first. Receiving a card during this trade
  // cannot fund the other side's payment or create a duplicate card.
  for(const [from,,leg]of legs)for(const r of RESOURCES)from.resources[r]-=leg.cards[r];
  for(const [,to,leg]of legs)for(const r of RESOURCES)credit(s,to.id,r,leg.cards[r],'trade');
  // New obligations start AFTER immediate payments and their existing claims.
  // Offsets are relative to the end of acceptance, not to proposal creation.
  for(const [from,to,leg]of legs)for(const f of leg.futures)for(let i=0;i<f.count;i++){
    const due=from.receipts[f.resource]+f.start+i;
    if(s.claims.some(c=>c.debtor===from.id&&c.resource===f.resource&&c.due===due))throw Error('That future delivery is already promised. Choose another delivery range.');
    if(s.claims.length>=200)throw Error('The market supports at most 200 outstanding deliveries.');
    s.claims.push({id:s.nextClaim++,debtor:from.id,beneficiary:to.id,resource:f.resource,due});
  }
  record(s,a.name+' and '+b.name+' completed a market trade.');
}
