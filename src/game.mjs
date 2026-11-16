import { RESOURCES, emptyCards, checkedCards, validateRules } from './rules.mjs';
import { makeBoard, shuffled, otherNode, roadLegal, settlementLegal, longestRoad, moveRoadLegal } from './board.mjs';
import { credit, totalCards, record, checkedLeg, hasLeg, settleTrade } from './market.mjs';
export { RESOURCES };
const player = (s,id) => {const p=s.players.find(p=>p.id===id);if(!p)throw Error('Unknown player.');return p;};
const requireRule = (condition,message) => {if(!condition)throw Error(message);};
export function cleanName(value) {
  requireRule(typeof value==='string','Enter a player name.');
  const name=value.trim().replace(/\s+/g,' ');
  requireRule(name.length>=1&&name.length<=24&&!/[\u0000-\u001f\u007f]/.test(name),'Use a name between 1 and 24 characters.');
  return name;
}
function newPlayer(id,name) {
  return {id,name:cleanName(name),resources:emptyCards(),receipts:emptyCards(),dev:[],knights:0,roadLength:0};
}
export function createGame(hostId,name,rules={},rng=Math.random) {
  return {schema:1,revision:0,hostId,phase:'lobby',players:[newPlayer(hostId,name)],rules:validateRules(rules),
    board:makeBoard(rng),bank:Object.fromEntries(RESOURCES.map(r=>[r,19])),
    deck:shuffled([...Array(14).fill('knight'),...Array(5).fill('victory'),...Array(2).fill('road-building'),...Array(2).fill('plenty'),...Array(2).fill('monopoly')],rng),
    turn:0,current:0,setupOrder:[],setupIndex:0,setupNode:null,dice:null,pendingDiscards:{},victims:[],
    devPlayed:false,freeRoads:0,returnPhase:'build',claims:[],offers:[],nextClaim:1,nextOffer:1,nextCard:1,
    longestRoadHolder:null,largestArmyHolder:null,winner:null,nextLog:1,log:[{id:0,text:'The table is open. Invite your friends.'}]};
}
export function addPlayer(state,id,name) {
  const s=structuredClone(state);
  requireRule(s.phase==='lobby','This game has already started.');
  requireRule(s.players.length<4,'This table is full.');
  const p=newPlayer(id,name);
  requireRule(!s.players.some(x=>x.id===id||x.name.toLowerCase()===p.name.toLowerCase()),'Choose a unique player name.');
  s.players.push(p);s.revision++;record(s,p.name+' joined the table.');return s;
}
export function activeId(s) {
  return s.phase.startsWith('setup')?s.setupOrder[s.setupIndex]:s.players[s.current]?.id;
}
export function canAfford(p,cost) {return RESOURCES.every(r=>p.resources[r]>=(cost[r]||0));}
function pay(s,p,cost) {
  requireRule(canAfford(p,cost),'You do not have enough resources.');
  for(const r of RESOURCES){const n=cost[r]||0;p.resources[r]-=n;s.bank[r]+=n;}
}
function pieces(s,id,type) {
  return type==='road'?s.board.edges.filter(e=>e.owner===id).length:s.board.nodes.filter(n=>n.owner===id&&n.building===type).length;
}
export function points(s,id,hidden=true) {
  const p=player(s,id);
  return s.board.nodes.reduce((n,v)=>n+(v.owner===id?(v.building==='city'?2:1):0),0)
    +(s.longestRoadHolder===id?2:0)+(s.largestArmyHolder===id?2:0)+(hidden?p.dev.filter(c=>c.type==='victory').length:0);
}
function updateAwards(s) {
  for(const p of s.players)p.roadLength=longestRoad(s,p.id);
  for(const [field,metric,min] of [['longestRoadHolder','roadLength',5],['largestArmyHolder','knights',3]]){
    const best=Math.max(...s.players.map(p=>p[metric]));
    const leaders=s.players.filter(p=>p[metric]===best&&best>=min);
    const old=s[field];
    if(!leaders.some(p=>p.id===old))s[field]=leaders.length===1?leaders[0].id:null;
  }
}
function finishIfWon(s) {
  if(s.phase==='lobby'||s.phase.startsWith('setup')||s.phase==='finished')return;
  const id=s.players[s.current].id;
  if(points(s,id)>=s.rules.targetPoints){s.winner=id;s.phase='finished';record(s,player(s,id).name+' wins with '+points(s,id)+' points!');}
}
function produce(s,sum) {
  for(const r of RESOURCES) {
    const due=new Map();
    for(const tile of s.board.tiles)if(tile.number===sum&&tile.resource===r&&tile.id!==s.board.robber){
      for(const nodeId of tile.nodes){const n=s.board.nodes[nodeId];if(n.owner)due.set(n.owner,(due.get(n.owner)||0)+(n.building==='city'?2:1));}
    }
    const demand=[...due.values()].reduce((a,b)=>a+b,0);
    if(demand>s.bank[r]&&due.size!==1){record(s,'The bank cannot meet '+r+' production this roll.');continue;}
    for(const [id,n]of due){const amount=Math.min(n,s.bank[r]);s.bank[r]-=amount;credit(s,id,r,amount,'production');}
  }
}
function takeFromBank(s,id,resource,count) {
  requireRule(RESOURCES.includes(resource)&&s.bank[resource]>=count,'The bank does not have enough of that resource.');
  s.bank[resource]-=count;credit(s,id,resource,count,'bank');
}
function marketAllowed(s,id,partner=null) {
  requireRule(['roll','build'].includes(s.phase),'The market is paused during setup, discarding, and robber actions.');
  requireRule(s.rules.tradeOnAnyTurn||activeId(s)===id||activeId(s)===partner,'Market trades are restricted to the active player.');
}
function returnFromRobber(s) {s.phase=s.returnPhase;s.victims=[];}
function adjacentVictims(s,id,tileId) {
  return [...new Set(s.board.tiles[tileId].nodes.map(i=>s.board.nodes[i].owner).filter(owner=>owner&&owner!==id&&totalCards(player(s,owner).resources)>0))];
}
export function tradeRatio(s,id,resource) {
  let ratio=s.rules.bankTradeRatio;
  for(const port of s.board.ports) {
    const e=s.board.edges[port.edge];
    if((!port.resource||port.resource===resource)&&[e.a,e.b].some(i=>s.board.nodes[i].owner===id))ratio=Math.min(ratio,port.ratio);
  }
  return ratio;
}
export function applyAction(state,id,action,rng=Math.random) {
  requireRule(action&&typeof action==='object'&&!Array.isArray(action),'Invalid action.');
  requireRule(typeof action.type==='string','Choose an action.');
  const s=structuredClone(state),p=player(s,id),active=activeId(s)===id;
  requireRule(s.phase!=='finished','This game has finished.');
  switch(action.type) {
    case 'rules':
      requireRule(id===s.hostId&&s.phase==='lobby','Only the host can edit rules before the game.');
      s.rules=validateRules(action.rules);record(s,p.name+' updated the house rules.');break;
    case 'start':
      requireRule(id===s.hostId&&s.phase==='lobby','Only the host can start this game.');
      requireRule(s.players.length>=2,'Invite at least one other player first.');
      s.setupOrder=[...s.players.map(x=>x.id),...s.players.map(x=>x.id).reverse()];s.setupIndex=0;s.phase='setup-settlement';
      record(s,'Place two settlements and roads in snake order.');break;
    case 'settlement': {
      requireRule(active&&['setup-settlement','build'].includes(s.phase),'You cannot place a settlement now.');
      const setup=s.phase==='setup-settlement';
      requireRule(settlementLegal(s,id,action.node,setup),'Choose a legal, unoccupied intersection at least two edges from another settlement.');
      requireRule(pieces(s,id,'settlement')<5,'You have no settlements left.');
      if(!setup)pay(s,p,s.rules.costs.settlement);
      const n=s.board.nodes[action.node];n.owner=id;n.building='settlement';
      if(setup) {
        s.setupNode=n.id;
        if(s.setupIndex>=s.players.length)for(const t of n.tiles){const r=s.board.tiles[t].resource;if(r!=='desert')takeFromBank(s,id,r,1);}
        s.phase='setup-road';
      }
      record(s,p.name+' built a settlement.');updateAwards(s);break;
    }
    case 'road': {
      requireRule(active&&['setup-road','build','free-road'].includes(s.phase),'You cannot build a road now.');
      const e=s.board.edges[action.edge];requireRule(e&&!e.owner,'Choose an empty road edge.');
      if(s.phase==='setup-road')requireRule([e.a,e.b].includes(s.setupNode),'Place the road beside your new settlement.');
      else requireRule(roadLegal(s,id,e.id),'Connect the road to your own network.');
      requireRule(pieces(s,id,'road')<15,'You have no road pieces left.');
      const previous=s.phase;
      if(previous==='build')pay(s,p,s.rules.costs.road);
      e.owner=id;record(s,p.name+' built a road.');
      if(previous==='setup-road'){
        s.setupIndex++;
        if(s.setupIndex===s.setupOrder.length){s.phase='roll';s.current=0;s.turn=1;record(s,'Setup complete. '+s.players[0].name+' rolls first.');}
        else s.phase='setup-settlement';
      } else if(previous==='free-road') {
        s.freeRoads--;
        if(s.freeRoads===0||pieces(s,id,'road')===15||!s.board.edges.some(edge=>roadLegal(s,id,edge.id)))s.phase=s.returnPhase;
      }
      updateAwards(s);break;
    }
    case 'city': {
      requireRule(active&&s.phase==='build','You cannot upgrade now.');
      const n=s.board.nodes[action.node];requireRule(n&&n.owner===id&&n.building==='settlement','Choose one of your settlements.');
      requireRule(pieces(s,id,'city')<4,'You have no cities left.');
      pay(s,p,s.rules.costs.city);n.building='city';record(s,p.name+' upgraded a settlement to a city.');break;
    }
    case 'move-road':
      requireRule(active&&s.phase==='build','You cannot renovate a road now.');
      requireRule(moveRoadLegal(s,id,action.from,action.to),'That renovation is illegal or would disconnect your existing pieces.');
      pay(s,p,s.rules.renovationCost);s.board.edges[action.from].owner=null;s.board.edges[action.to].owner=id;
      record(s,p.name+' renovated a road.');updateAwards(s);break;
    case 'roll':
      requireRule(active&&s.phase==='roll','It is not your time to roll.');
      s.dice=[1+Math.floor(rng()*6),1+Math.floor(rng()*6)];
      record(s,p.name+' rolled '+(s.dice[0]+s.dice[1])+'.');
      if(s.dice[0]+s.dice[1]===7){
        s.returnPhase='build';s.pendingDiscards={};
        for(const q of s.players){const n=totalCards(q.resources);if(n>s.rules.discardLimit&&Math.floor(n/2)>0)s.pendingDiscards[q.id]=Math.floor(n/2);}
        s.phase=Object.keys(s.pendingDiscards).length?'discard':'robber';
      }else{produce(s,s.dice[0]+s.dice[1]);s.phase='build';}
      break;
    case 'discard': {
      requireRule(s.phase==='discard'&&s.pendingDiscards[id]>0,'You do not need to discard.');
      const cards=checkedCards(action.cards);requireRule(totalCards(cards)===s.pendingDiscards[id],'Discard exactly '+s.pendingDiscards[id]+' resources.');
      pay(s,p,cards);delete s.pendingDiscards[id];record(s,p.name+' discarded resources.');
      if(!Object.keys(s.pendingDiscards).length)s.phase='robber';break;
    }
    case 'robber':
      requireRule(active&&s.phase==='robber','You cannot move the robber now.');
      requireRule(Number.isInteger(action.tile)&&s.board.tiles[action.tile]&&action.tile!==s.board.robber,'Choose a different land tile.');
      s.board.robber=action.tile;s.victims=adjacentVictims(s,id,action.tile);
      record(s,p.name+' moved the robber.');
      if(s.victims.length)s.phase='steal';else returnFromRobber(s);break;
    case 'steal': {
      requireRule(active&&s.phase==='steal'&&s.victims.includes(action.victim),'Choose a neighboring player to steal from.');
      const victim=player(s,action.victim),bag=RESOURCES.flatMap(r=>Array(victim.resources[r]).fill(r));
      if(bag.length){const r=bag[Math.floor(rng()*bag.length)];victim.resources[r]--;credit(s,id,r,1,'theft');}
      record(s,p.name+' stole one resource from '+victim.name+'.');returnFromRobber(s);break;
    }
    case 'bank': {
      requireRule(active&&s.phase==='build','Bank trades happen during your build phase.');
      requireRule(RESOURCES.includes(action.give)&&RESOURCES.includes(action.receive)&&action.give!==action.receive,'Choose two different resources.');
      requireRule(Number.isInteger(action.count)&&action.count>=1&&action.count<=10,'Choose between 1 and 10 resources to receive.');
      const cost={[action.give]:tradeRatio(s,id,action.give)*action.count};
      requireRule(s.bank[action.receive]>=action.count,'The bank is short of that resource.');
      pay(s,p,cost);takeFromBank(s,id,action.receive,action.count);
      record(s,p.name+' traded with the bank.');break;
    }
    case 'offer': {
      marketAllowed(s,id,action.to);player(s,action.to);requireRule(action.to!==id,'Choose another player.');
      requireRule(s.offers.filter(o=>o.from===id).length<10,'Cancel an older offer first.');
      const give=checkedLeg(action.give),want=checkedLeg(action.want);
      requireRule(hasLeg(give)&&hasLeg(want),'Both sides must offer something.');
      requireRule(s.rules.futuresEnabled||(!give.futures.length&&!want.futures.length),'Futures are disabled.');
      requireRule(canAfford(p,give.cards),'You do not have the offered resources.');
      s.offers.push({id:s.nextOffer++,from:id,to:action.to,give,want});
      record(s,p.name+' posted a market offer for '+player(s,action.to).name+'.');break;
    }
    case 'accept': {
      const offer=s.offers.find(o=>o.id===action.offer);requireRule(offer&&offer.to===id,'That offer is no longer available to you.');
      marketAllowed(s,id,offer.from);
      settleTrade(s,offer);s.offers=s.offers.filter(o=>o.id!==offer.id);break;
    }
    case 'cancel': {
      const offer=s.offers.find(o=>o.id===action.offer);requireRule(offer&&(offer.from===id||offer.to===id),'You cannot cancel that offer.');
      s.offers=s.offers.filter(o=>o.id!==offer.id);break;
    }
    case 'buy-development': {
      requireRule(active&&s.phase==='build','You cannot buy a development card now.');
      requireRule(s.deck.length>0,'The development deck is empty.');pay(s,p,s.rules.costs.development);
      p.dev.push({id:s.nextCard++,type:s.deck.pop(),boughtOnTurn:s.turn});record(s,p.name+' bought a development card.');break;
    }
    case 'play-development': {
      requireRule(active&&['roll','build'].includes(s.phase),'You cannot play a development card now.');
      requireRule(!s.devPlayed,'You already played a development card this turn.');
      const index=p.dev.findIndex(c=>c.id===action.card),card=p.dev[index];
      requireRule(card&&card.type!=='victory'&&card.boughtOnTurn<s.turn,'Choose a playable card bought on a previous turn.');
      s.returnPhase=s.phase;
      if(card.type==='knight'){p.knights++;s.phase='robber';updateAwards(s);}
      if(card.type==='road-building'){s.freeRoads=Math.min(2,15-pieces(s,id,'road'));s.phase=s.freeRoads?'free-road':s.returnPhase;}
      if(card.type==='plenty'){
        requireRule(Array.isArray(action.resources)&&action.resources.length===2,'Choose two resources.');
        const need=emptyCards();for(const r of action.resources){requireRule(RESOURCES.includes(r),'Invalid resource.');need[r]++;}
        requireRule(RESOURCES.every(r=>s.bank[r]>=need[r]),'The bank cannot supply those cards.');
        for(const r of RESOURCES)takeFromBank(s,id,r,need[r]);
      }
      if(card.type==='monopoly'){
        requireRule(RESOURCES.includes(action.resource),'Choose a resource.');
        let count=0;for(const q of s.players)if(q.id!==id){count+=q.resources[action.resource];q.resources[action.resource]=0;}
        credit(s,id,action.resource,count,'monopoly');
      }
      p.dev.splice(index,1);s.devPlayed=true;record(s,p.name+' played '+card.type+'.');break;
    }
    case 'skip-free-roads':
      requireRule(active&&s.phase==='free-road','There are no free roads to skip.');s.freeRoads=0;s.phase=s.returnPhase;break;
    case 'end':
      requireRule(active&&s.phase==='build','Complete your roll and any required actions before ending your turn.');
      s.current=(s.current+1)%s.players.length;s.turn++;s.phase='roll';s.devPlayed=false;
      record(s,player(s,activeId(s)).name+' begins a turn.');break;
    default: throw Error('Unknown action.');
  }
  s.revision++;finishIfWon(s);return s;
}
export function viewGame(s,id) {
  const me=player(s,id),active=activeId(s)===id;
  const legal={roads:[],settlements:[],cities:[],moveSources:[],moveTargets:{}};
  if(active){
    if(s.phase==='setup-settlement'||(s.phase==='build'&&canAfford(me,s.rules.costs.settlement)&&pieces(s,id,'settlement')<5))
      legal.settlements=s.board.nodes.filter(n=>settlementLegal(s,id,n.id,s.phase==='setup-settlement')).map(n=>n.id);
    if(s.phase==='setup-road')legal.roads=s.board.edges.filter(e=>!e.owner&&[e.a,e.b].includes(s.setupNode)).map(e=>e.id);
    if((s.phase==='free-road'||(s.phase==='build'&&canAfford(me,s.rules.costs.road)))&&pieces(s,id,'road')<15)
      legal.roads=s.board.edges.filter(e=>roadLegal(s,id,e.id)).map(e=>e.id);
    if(s.phase==='build'){
      if(canAfford(me,s.rules.costs.city)&&pieces(s,id,'city')<4)legal.cities=s.board.nodes.filter(n=>n.owner===id&&n.building==='settlement').map(n=>n.id);
      if(canAfford(me,s.rules.renovationCost))for(const e of s.board.edges.filter(e=>e.owner===id)){
        const targets=s.board.edges.filter(target=>moveRoadLegal(s,id,e.id,target.id)).map(target=>target.id);
        if(targets.length){legal.moveSources.push(e.id);legal.moveTargets[e.id]=targets;}
      }
    }
  }
  return {
    schema:s.schema,revision:s.revision,phase:s.phase,hostId:s.hostId,current:activeId(s),turn:s.turn,
    board:structuredClone(s.board),bank:{...s.bank},rules:structuredClone(s.rules),dice:s.dice,legal,
    players:s.players.map(p=>({
      id:p.id,name:p.name,score:points(s,p.id,p.id===id||s.phase==='finished'),resourceCount:totalCards(p.resources),
      developmentCount:p.dev.length,knights:p.knights,roadLength:p.roadLength,
      receipts:{...p.receipts},pieces:{roads:pieces(s,p.id,'road'),settlements:pieces(s,p.id,'settlement'),cities:pieces(s,p.id,'city')}
    })),
    me:{id,resources:{...me.resources},dev:structuredClone(me.dev),bankRatios:Object.fromEntries(RESOURCES.map(r=>[r,tradeRatio(s,id,r)])),
      canBuyDevelopment:active&&s.phase==='build'&&s.deck.length>0&&canAfford(me,s.rules.costs.development),
      canPlayDevelopment:active&&['roll','build'].includes(s.phase)&&!s.devPlayed,
      canMarket:['roll','build'].includes(s.phase)&&(s.rules.tradeOnAnyTurn||active)},
    deckCount:s.deck.length,claims:structuredClone(s.claims),offers:structuredClone(s.offers),log:structuredClone(s.log),
    pendingDiscards:{...s.pendingDiscards},victims:[...s.victims],devPlayed:s.devPlayed,
    longestRoadHolder:s.longestRoadHolder,largestArmyHolder:s.largestArmyHolder,winner:s.winner
  };
}
