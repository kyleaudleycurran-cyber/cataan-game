const $=id=>document.getElementById(id);
const R=['wood','brick','wool','grain','ore'];
const label={wood:'Wood',brick:'Brick',wool:'Wool',grain:'Wheat',ore:'Ore'};
const symbol={wood:'♠',brick:'▰',wool:'♧',grain:'♧',ore:'▲'};
const devLabel={knight:'Knight','road-building':'Road building',plenty:'Year of plenty',monopoly:'Monopoly',victory:'Victory point'};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session=null,game=null,pending=false,polling=false,tool=null,moveFrom=null,selectedDev=null,toastTimer;
let seats={};
try{const saved=JSON.parse(localStorage.getItem('cataan_seats_v1')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))seats=saved;}catch{}
const getPlayer=id=>game.players.find(p=>p.id===id);
const playerName=id=>getPlayer(id)?.name||id;
const colorClass=id=>'p'+Math.max(0,game.players.findIndex(p=>p.id===id));
const isActive=()=>game?.current===session?.playerId;
const sum=cards=>R.reduce((n,r)=>n+(cards[r]||0),0);
const resourceOptions=()=>R.map(r=>'<option value="'+r+'">'+label[r]+'</option>').join('');
function toast(message) {
  clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,6500);
}
async function api(path,{method='GET',data,auth=session}={}) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(path,{method,signal:controller.signal,headers:{...(data?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth.token}:{})},body:data?JSON.stringify(data):undefined});
    if(response.status===204)return null;
    const result=await response.json();
    if(!response.ok)throw Object.assign(Error(result.error||'Request failed.'),{status:response.status,game:result.game});
    return result;
  }finally{clearTimeout(timeout);}
}
function snapshot(next) {if(!game||next.revision>=game.revision)game=next;}
function saveSession(value) {
  session=value;
  try{seats[value.room]=value;localStorage.setItem('cataan_seats_v1',JSON.stringify(seats));localStorage.setItem('cataan_current_v1',value.room);}catch{toast('This browser cannot remember your seat. Keep this tab open.');}
  history.replaceState({},'','/?room='+encodeURIComponent(value.room));
}
async function enter(result) {
  saveSession({room:result.room,token:result.token,playerId:result.playerId});
  game=result.game;tool=null;moveFrom=null;render();
}
async function reconnect(saved) {
  const result=await api('/api/rooms/'+saved.room,{auth:saved});
  saveSession(saved);game=result.game;tool=null;moveFrom=null;render();
}
async function send(action) {
  if(pending||!session||!game)return false;
  pending=true;render();
  try{
    const current=session;
    const result=await api('/api/rooms/'+current.room+'/actions',{method:'POST',data:{revision:game.revision,action},auth:current});
    if(session?.room===current.room){snapshot(result.game);tool=null;moveFrom=null;}
    return true;
  }catch(error){if(error.game)snapshot(error.game);toast(error.name==='AbortError'?'Connection timed out. Check the table before trying again.':error.message);return false;}
  finally{pending=false;render();}
}
async function poll() {
  if(!session||pending||polling||document.hidden)return;
  polling=true;const current=session;
  try{
    const result=await api('/api/rooms/'+current.room+'?since='+game.revision,{auth:current});
    if(session?.room===current.room){if(result){snapshot(result.game);render();}$('connection').textContent='Connected · private room';}
  }catch{$('connection').textContent='Reconnecting to the table…';}
  finally{polling=false;}
}
function costText(cost) {
  const parts=R.filter(r=>cost[r]).map(r=>cost[r]+' '+label[r].toLowerCase());
  return parts.length?parts.join(' · '):'Free';
}
function legText(leg) {
  const parts=R.filter(r=>leg.cards[r]).map(r=>leg.cards[r]+' '+label[r].toLowerCase());
  for(const f of leg.futures){
    const range=f.start===1?(f.count===1?'next':'next '+f.count):'#'+f.start+(f.count>1?'–'+(f.start+f.count-1):'');
    parts.push(range+' '+label[f.resource].toLowerCase()+' '+(f.count===1?'delivery':'deliveries'));
  }
  return parts.join(' + ');
}
function terrainMark(resource,x,y) {
  let paths='';
  if(resource==='wood')paths='<path d="M-13 1L-5-13 3 1ZM0 5L9-11 18 5ZM-5 1V9M9 5V12"/>';
  if(resource==='brick')paths='<path d="M-18-7H-2V1H-18ZM1-7H17V1H1ZM-10 4H6V12H-10Z"/>';
  if(resource==='wool')paths='<path d="M-13 4C-23-3-12-13-7-8C-2-17 9-11 8-6C20-9 23 8 12 8H-8ZM-7 8V13M8 8V13"/>';
  if(resource==='grain')paths='<path d="M0 15V-15M0-7C-12-9-10-16 0-10M0 0C12-2 10-10 0-4M0 6C-12 4-10-4 0 1M0 12C12 10 10 3 0 7"/>';
  if(resource==='ore')paths='<path d="M-22 12L-6-13 8 12ZM-7 12L8-7 24 12ZM-10-6L-6-1-2-6"/>';
  if(resource==='desert')paths='<path d="M-25 9Q-7-10 14 9M-8 13Q8-4 26 10"/>';
  return '<g class="terrain-mark" transform="translate('+x+' '+y+')">'+paths+'</g>';
}
function boardMarkup() {
  const b=game.board,S=63;
  const xy=id=>[b.nodes[id].x*S,b.nodes[id].y*S];
  const n=v=>Number(v).toFixed(2);
  const points=tile=>tile.nodes.map(id=>xy(id).map(n).join(',')).join(' ');
  const legalNodes=tool==='settlement'?game.legal.settlements:tool==='city'?game.legal.cities:[];
  const legalEdges=tool==='road'?game.legal.roads:tool==='move'?(moveFrom===null?game.legal.moveSources:(game.legal.moveTargets[moveFrom]||[])):[];
  let out='<svg viewBox="-340 -310 680 620" role="group" aria-label="Island board. Legal placements are highlighted. Tab to a highlighted location and press Enter to place."><title>Cataan island</title><circle class="sea-ring" r="278"/><circle class="sea-ring" r="286"/>';
  for(const t of b.tiles){
    const x=t.x*S,y=t.y*S,red=t.number===6||t.number===8,producing=game.phase==='build'&&game.dice&&game.dice[0]+game.dice[1]===t.number&&b.robber!==t.id;
    out+='<polygon class="tile '+t.resource+(producing?' producing':'')+'" points="'+points(t)+'"/>'+terrainMark(t.resource,n(x),n(y-23));
    if(t.number){
      out+='<circle class="number-disc" cx="'+n(x)+'" cy="'+n(y+9)+'" r="18"/><text class="number-label'+(red?' red-number':'')+'" x="'+n(x)+'" y="'+n(y+7)+'">'+t.number+'</text>';
      const count=6-Math.abs(7-t.number);
      for(let i=0;i<count;i++)out+='<circle class="probability" cx="'+n(x+(i-(count-1)/2)*4)+'" cy="'+n(y+20)+'" r="1.15"/>';
    }
    if(b.robber===t.id)out+='<g class="robber" transform="translate('+n(x+23)+' '+n(y+5)+')"><circle cy="-13" r="5"/><path d="M-4-7H4L8 9H-8Z"/></g>';
    if(tool==='robber'&&t.id!==b.robber)out+='<polygon class="tile-button board-target" role="button" tabindex="0" data-tile="'+t.id+'" aria-label="Move robber to '+esc(label[t.resource]||'desert')+' tile '+(t.number||'')+'" points="'+points(t)+'"/>';
  }
  for(const port of b.ports){
    const e=b.edges[port.edge],a=xy(e.a),c=xy(e.b),x=(a[0]+c[0])/2,y=(a[1]+c[1])/2,px=x*1.18,py=y*1.18;
    out+='<line class="port-line" x1="'+n(x)+'" y1="'+n(y)+'" x2="'+n(px)+'" y2="'+n(py)+'"/><circle class="port-disc" cx="'+n(px)+'" cy="'+n(py)+'" r="16"/><text class="port-label" x="'+n(px)+'" y="'+n(py-3)+'">'+port.ratio+':1</text><text class="port-label port-resource" x="'+n(px)+'" y="'+n(py+7)+'">'+(port.resource?label[port.resource]:'Any')+'</text>';
  }
  for(const e of b.edges){
    const a=xy(e.a),c=xy(e.b),attrs=' x1="'+n(a[0])+'" y1="'+n(a[1])+'" x2="'+n(c[0])+'" y2="'+n(c[1])+'"';
    out+='<line class="edge-visible"'+attrs+'/>';
    if(e.owner)out+='<line class="road-owned '+colorClass(e.owner)+'"'+attrs+'/>';
    if(legalEdges.includes(e.id)||moveFrom===e.id)out+='<line class="road-highlight"'+attrs+'/>';
    if(legalEdges.includes(e.id))out+='<line class="edge-hit board-target" role="button" tabindex="0" data-edge="'+e.id+'" aria-label="'+(tool==='move'?'Renovate':'Build')+' road at edge '+e.id+'"'+attrs+'/>';
  }
  for(const node of b.nodes){
    const x=node.x*S,y=node.y*S;
    if(node.owner){
      const path=node.building==='city'?'M-14 10V-4L-6-11 2-4V0H10V-9H16V10Z':'M-11 9V-3L0-13 11-3V9Z';
      out+='<path class="building '+colorClass(node.owner)+'" transform="translate('+n(x)+' '+n(y)+')" d="'+path+'"/>';
    }
    if(legalNodes.includes(node.id))out+='<g class="board-target" role="button" tabindex="0" data-node="'+node.id+'" aria-label="'+(tool==='city'?'Upgrade city':'Place settlement')+' at intersection '+node.id+'"><circle class="node-highlight" cx="'+n(x)+'" cy="'+n(y)+'" r="6"/><circle class="node-hit" cx="'+n(x)+'" cy="'+n(y)+'" r="15"/></g>';
  }
  return out+'</svg>';
}
function renderPlayers() {
  $('player-count').textContent=game.players.length+'/4';
  $('players').innerHTML=game.players.map(p=>'<div class="player-row '+colorClass(p.id)+'"><div class="avatar">'+esc(p.name.slice(0,1).toUpperCase())+'</div><div><div class="player-name">'+(p.id===game.current&&game.phase!=='lobby'?'<i class="turn-dot"></i>':'')+esc(p.name)+(p.id===session.playerId?' <span class="muted">(you)</span>':'')+'</div><div class="player-meta">'+p.resourceCount+' cards · '+p.developmentCount+' dev<br>'+p.roadLength+' road · '+p.knights+' knights'+(game.longestRoadHolder===p.id?' · Longest road':'')+(game.largestArmyHolder===p.id?' · Largest army':'')+'</div></div><div class="score">'+p.score+'<small>/ '+game.rules.targetPoints+' VP</small></div></div>').join('');
  $('bank-stock').innerHTML='<div class="bank-stock"><b>Bank reserves</b><br>'+R.map(r=>label[r]+' '+game.bank[r]).join(' · ')+'<br>Development cards '+game.deckCount+'</div>';
}
function renderMarket() {
  $('offer-button').disabled=pending||!game.me.canMarket;
  const offers=game.offers.map(o=>{
    const mine=o.from===session.playerId,forMe=o.to===session.playerId;
    let controls='';
    if(forMe)controls='<button class="button primary" data-accept="'+o.id+'"'+(pending||!game.me.canMarket?' disabled':'')+'>Accept</button>';
    if(mine||forMe)controls+='<button class="button outline" data-cancel="'+o.id+'"'+(pending?' disabled':'')+'>'+(mine?'Cancel':'Decline')+'</button>';
    return '<div class="offer-card"><strong>'+esc(mine?'You':playerName(o.from))+' → '+esc(forMe?'you':playerName(o.to))+'</strong><br>Gives '+esc(legText(o.give))+'<br>Wants '+esc(legText(o.want))+(controls?'<div class="offer-actions">'+controls+'</div>':'')+'</div>';
  });
  $('offers').innerHTML=offers.length?offers.join(''):'<p class="empty-state">No offers on the table.<br>Good deals start with a conversation.</p>';
  const groups=new Map();
  for(const claim of game.claims){
    const key=claim.debtor+':'+claim.beneficiary+':'+claim.resource;
    if(!groups.has(key))groups.set(key,{...claim,offsets:[]});
    groups.get(key).offsets.push(claim.due-getPlayer(claim.debtor).receipts[claim.resource]);
  }
  const futures=[...groups.values()].map(c=>'<div class="future-row"><b>'+esc(playerName(c.debtor))+' → '+esc(playerName(c.beneficiary))+'</b><div class="future-label">'+esc(label[c.resource])+' · incoming #'+c.offsets.sort((a,b)=>a-b).join(', #')+'</div></div>');
  $('futures').innerHTML=futures.length?futures.slice(0,5).join('')+(futures.length>5?'<details><summary>'+String(futures.length-5)+' more obligations</summary>'+futures.slice(5).join('')+'</details>':''):'<p class="empty-state">No outstanding promises. Yet.</p>';
}
function phaseStatus() {
  const who=game.current===session.playerId?'Your':playerName(game.current)+'’s';
  if(game.phase==='lobby')return 'Waiting for friends to join.';
  if(game.phase==='finished')return playerName(game.winner)+' wins the island.';
  if(game.phase==='setup-settlement')return who+' starting settlement';
  if(game.phase==='setup-road')return who+' starting road';
  if(game.phase==='roll')return who+' turn to roll';
  if(game.phase==='discard')return 'A seven. Players are returning resources.';
  if(game.phase==='robber')return who+' turn to move the robber';
  if(game.phase==='steal')return who+' turn to choose a victim';
  if(game.phase==='free-road')return who+' free road placement';
  return who+' turn to build & trade';
}
function renderControls() {
  const active=isActive(),disabled=pending?' disabled':'';
  let controls='';
  if(active&&game.phase==='roll')controls='<button class="button primary" data-action="roll"'+disabled+'>Roll dice ↗</button>';
  if(active&&game.phase==='build')controls='<button class="button outline" data-open-bank'+disabled+'>Bank trade</button><button class="button primary" data-action="end"'+disabled+'>End turn →</button>';
  if(active&&game.phase==='free-road')controls='<button class="button outline" data-action="skip-free-roads"'+disabled+'>Skip remaining roads</button>';
  if(game.phase==='discard'&&game.pendingDiscards[session.playerId])controls='<button class="button primary" data-open-discard'+disabled+'>Discard '+game.pendingDiscards[session.playerId]+'</button>';
  if(active&&game.phase==='steal')controls=game.victims.map(id=>'<button class="button primary" data-steal="'+esc(id)+'"'+disabled+'>Steal from '+esc(playerName(id))+'</button>').join('');
  const dice=game.dice?'<div class="dice-row" aria-label="Dice '+game.dice.join(' and ')+'">'+game.dice.map(d=>'<span class="die">'+d+'</span>').join('')+'</div>':'';
  $('turn-controls').innerHTML='<div class="turn-status"><strong>'+esc(phaseStatus())+'</strong></div><div class="turn-action">'+dice+controls+'</div>';
  const definitions=[['road','━','Road',game.rules.costs.road,game.legal.roads.length],['settlement','⌂','Settlement',game.rules.costs.settlement,game.legal.settlements.length],['city','♜','City',game.rules.costs.city,game.legal.cities.length],['move','↝','Renovate',game.rules.renovationCost,game.legal.moveSources.length]];
  $('build-controls').innerHTML=definitions.map(([key,icon,title,cost,count])=>'<button class="build-button'+(tool===key?' selected':'')+'" data-tool="'+key+'" aria-pressed="'+(tool===key)+'"'+(pending||!active||game.phase!=='build'||!count?' disabled':'')+'><span class="build-icon" aria-hidden="true">'+icon+'</span><b>'+title+'</b><small>'+esc(costText(cost))+'</small></button>').join('');
  let hint='The first great deal is waiting to happen.';
  if(game.phase==='lobby')hint='Invite friends using the room code or link, then start the game.';
  else if(game.phase==='finished')hint='The island has a winner. Create another table to play again.';
  else if(!active)hint=game.me.canMarket?'Watch the island. The market is open on every turn.':'Waiting for '+playerName(game.current)+'.';
  else if(tool==='road')hint='Choose a highlighted edge to build your road.';
  else if(tool==='settlement')hint='Choose a highlighted intersection for your settlement.';
  else if(tool==='city')hint='Choose a highlighted settlement to upgrade.';
  else if(tool==='move')hint=moveFrom===null?'Choose a highlighted road to renovate.':'Choose a highlighted destination for that road.';
  else if(tool==='robber')hint='Choose another land tile to move the robber.';
  else if(game.phase==='roll')hint='Roll the dice to see what the island provides.';
  else if(game.phase==='build')hint='Build, renovate, play a card, or make a trade.';
  $('board-hint').textContent=hint;
  $('cancel-tool').hidden=!tool||game.phase!=='build';$('cancel-tool').disabled=pending;
}
function renderHand() {
  $('hand').innerHTML=R.map(r=>'<div class="resource-card '+r+'"><span class="resource-symbol" aria-hidden="true">'+symbol[r]+'</span><div><strong>'+label[r]+'</strong><small>'+game.me.bankRatios[r]+':1 at bank</small></div><span class="resource-count">'+game.me.resources[r]+'</span></div>').join('');
  const cards=game.me.dev.map(card=>{
    const playable=card.type!=='victory'&&card.boughtOnTurn<game.turn&&game.me.canPlayDevelopment;
    return '<button class="development-card" data-dev="'+card.id+'"'+(pending||!playable?' disabled':'')+'>'+devLabel[card.type]+(card.type==='victory'?' · 1 VP':card.boughtOnTurn===game.turn?' · next turn':'')+'</button>';
  });
  cards.push('<button class="button outline" data-action="buy-development"'+(pending||!game.me.canBuyDevelopment?' disabled':'')+'>＋ Development card · '+esc(costText(game.rules.costs.development))+'</button>');
  $('development').innerHTML=cards.join('');
}
function render() {
  $('welcome').hidden=!!session;$('game').hidden=!session;$('home-button').hidden=!session;
  if(!session||!game)return;
  $('connection').textContent='Connected · private room';
  $('room-label').textContent='ROOM '+session.room;
  $('turn-label').textContent=game.phase==='lobby'?'2–4 PLAYERS':'TURN '+game.turn;
  if(isActive()){
    if(game.phase==='setup-settlement')tool='settlement';
    else if(game.phase==='setup-road'||game.phase==='free-road')tool='road';
    else if(game.phase==='robber')tool='robber';
    else if(game.phase!=='build'){tool=null;moveFrom=null;}
  }else{tool=null;moveFrom=null;}
  const lobby=game.phase==='lobby',won=game.phase==='finished';
  $('lobby-panel').hidden=!(lobby||won);
  $('lobby-panel').className=won?'winner-banner':'lobby-banner';
  if(lobby)$('lobby-panel').innerHTML='<div><b>Your table is ready.</b><p>Share room '+session.room+' with friends. Rules lock when the game begins.</p></div>'+(game.hostId===session.playerId?'<button class="button primary" data-action="start"'+(game.players.length<2||pending?' disabled':'')+'>Start game · '+game.players.length+' players →</button>':'<span>Waiting for the host to start.</span>');
  if(won)$('lobby-panel').innerHTML='<div><b>'+esc(playerName(game.winner))+' wins with '+getPlayer(game.winner).score+' points.</b><p>Every promise, every road, every deal led here.</p></div><button class="button primary" data-new-table>New table ↗</button>';
  renderPlayers();renderMarket();renderControls();renderHand();
  $('board').innerHTML=boardMarkup();
  $('activity').innerHTML=game.log.slice(-16).reverse().map(item=>'<li>'+esc(item.text)+'</li>').join('');
  if(game.phase==='discard'&&game.pendingDiscards[session.playerId]){
    if(!$('discard-dialog').open)openDiscard();
  }else if($('discard-dialog').open)$('discard-dialog').close();
}
function amountFields(prefix,cards={},maxima=null) {
  return R.map(r=>'<label class="amount-row"><span><i class="resource-dot '+r+'"></i> '+label[r]+'</span><input type="number" min="0" max="'+(maxima?maxima[r]:30)+'" value="'+(cards[r]||0)+'" data-resource="'+r+'" aria-label="'+label[r]+' '+prefix+'"></label>').join('');
}
function openRules() {
  const r=game.rules,editable=game.hostId===session.playerId&&game.phase==='lobby';
  $('rule-fields').innerHTML='<div class="form-grid"><label>Victory points<input id="rule-target" type="number" min="3" max="30" value="'+r.targetPoints+'"></label><label>Default bank ratio<input id="rule-ratio" type="number" min="2" max="8" value="'+r.bankTradeRatio+'"></label><label>Hand limit on a seven<input id="rule-discard" type="number" min="0" max="50" value="'+r.discardLimit+'"></label></div><label class="checkbox-row"><input id="rule-futures" type="checkbox"'+(r.futuresEnabled?' checked':'')+'>Enable binding resource futures</label><label class="checkbox-row"><input id="rule-anyturn" type="checkbox"'+(r.tradeOnAnyTurn?' checked':'')+'>Allow market trades on any player’s turn</label><label class="checkbox-row"><input id="rule-connections" type="checkbox"'+(r.preserveRoadConnections?' checked':'')+'>Road renovation preserves existing connections</label><p class="field-heading">Road renovation price</p><div class="rule-cost-grid">'+R.map(res=>'<label>'+label[res]+'<input type="number" min="0" max="20" value="'+(r.renovationCost[res]||0)+'" id="renovation-'+res+'"></label>').join('')+'</div>';
  $('rules-json').value=JSON.stringify(r,null,2);$('rules-json').readOnly=!editable;$('use-rule-json').checked=false;
  $('rules-form').querySelectorAll('input').forEach(input=>input.disabled=!editable);
  $('save-rules').hidden=!editable;$('rules-dialog').showModal();
}
function addFuture(prefix,initial={resource:'grain',start:1,count:1}) {
  if(!game.rules.futuresEnabled)return;
  const parent=$(prefix+'-futures');
  if(parent.children.length>=5)return toast('Use up to five future ranges per side.');
  const row=document.createElement('div');row.className='future-form-row';
  row.innerHTML='<label>Resource promised<select data-field="resource">'+resourceOptions()+'</select></label><div class="future-range"><label>Start at delivery #<input data-field="start" type="number" min="1" max="100" value="'+initial.start+'"></label><label>Quantity<input data-field="count" type="number" min="1" max="10" value="'+initial.count+'"></label></div><button type="button" class="text-button" data-remove-future>Remove future</button>';
  row.querySelector('select').value=initial.resource;parent.append(row);
}
function openTrade() {
  if(!game.me.canMarket)return;
  $('trade-partner').innerHTML=game.players.filter(p=>p.id!==session.playerId).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  $('give-cards').innerHTML=amountFields('give');$('want-cards').innerHTML=amountFields('receive');
  $('give-futures').innerHTML='';$('want-futures').innerHTML='';
  document.querySelectorAll('[data-add-future]').forEach(button=>button.hidden=!game.rules.futuresEnabled);
  $('trade-dialog').showModal();
}
function tradeLeg(prefix) {
  const cards=Object.fromEntries([...$(prefix+'-cards').querySelectorAll('input')].map(input=>[input.dataset.resource,Number(input.value)]));
  const futures=[...$(prefix+'-futures').children].map(row=>({resource:row.querySelector('[data-field="resource"]').value,start:Number(row.querySelector('[data-field="start"]').value),count:Number(row.querySelector('[data-field="count"]').value)}));
  return {cards,futures};
}
function openBank() {
  $('bank-give').innerHTML=resourceOptions();$('bank-receive').innerHTML=resourceOptions();$('bank-receive').value='grain';$('bank-count').value='1';updateBankPreview();$('bank-dialog').showModal();
}
function updateBankPreview() {
  if(!game)return;
  const r=$('bank-give').value,n=Number($('bank-count').value)||1;
  $('bank-preview').textContent='Pay '+(game.me.bankRatios[r]*n)+' '+label[r].toLowerCase()+' for '+n+' '+label[$('bank-receive').value].toLowerCase()+'. Your ratio: '+game.me.bankRatios[r]+':1.';
}
function openDiscard() {
  $('discard-instruction').textContent='Choose exactly '+game.pendingDiscards[session.playerId]+' resource cards to return to the bank.';
  $('discard-fields').innerHTML=amountFields('discard',{},game.me.resources);
  if(!$('discard-dialog').open)$('discard-dialog').showModal();
}
function leaveView() {
  session=null;game=null;tool=null;moveFrom=null;
  try{localStorage.removeItem('cataan_current_v1');}catch{}
  history.replaceState({},'','/');
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());render();
}
async function boardClick(event) {
  if(pending||!isActive())return;
  const target=event.target.closest('[data-node],[data-edge],[data-tile]');if(!target)return;
  if(target.hasAttribute('data-tile'))return send({type:'robber',tile:Number(target.dataset.tile)});
  if(target.hasAttribute('data-node'))return send({type:tool==='city'?'city':'settlement',node:Number(target.dataset.node)});
  const edge=Number(target.dataset.edge);
  if(tool==='move'){
    if(moveFrom===null){moveFrom=edge;render();}else await send({type:'move-road',from:moveFrom,to:edge});
  }else await send({type:'road',edge});
}
$('board').addEventListener('click',boardClick);
$('board').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();boardClick(event);}});
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.close)$(b.dataset.close).close();
  if(b.hasAttribute('data-action'))await send({type:b.dataset.action});
  if(b.hasAttribute('data-tool')){tool=tool===b.dataset.tool?null:b.dataset.tool;moveFrom=null;render();}
  if(b.hasAttribute('data-accept'))await send({type:'accept',offer:Number(b.dataset.accept)});
  if(b.hasAttribute('data-cancel'))await send({type:'cancel',offer:Number(b.dataset.cancel)});
  if(b.hasAttribute('data-steal'))await send({type:'steal',victim:b.dataset.steal});
  if(b.hasAttribute('data-open-bank'))openBank();
  if(b.hasAttribute('data-open-discard'))openDiscard();
  if(b.hasAttribute('data-add-future'))addFuture(b.dataset.addFuture);
  if(b.hasAttribute('data-remove-future'))b.closest('.future-form-row').remove();
  if(b.hasAttribute('data-new-table'))leaveView();
  if(b.hasAttribute('data-dev')){
    const card=game.me.dev.find(c=>c.id===Number(b.dataset.dev));if(!card)return;
    if(['knight','road-building'].includes(card.type))await send({type:'play-development',card:card.id});
    else{
      selectedDev=card;$('development-title').textContent=devLabel[card.type];
      $('development-fields').innerHTML=card.type==='plenty'?'<label>First resource<select id="dev-first">'+resourceOptions()+'</select></label><label>Second resource<select id="dev-second">'+resourceOptions()+'</select></label>':'<label>Take this resource from every other player<select id="dev-resource">'+resourceOptions()+'</select></label>';
      $('development-dialog').showModal();
    }
  }
});
$('create-button').addEventListener('click',async()=>{
  if(pending)return;pending=true;$('create-button').disabled=true;
  try{await enter(await api('/api/rooms',{method:'POST',auth:null,data:{name:$('player-name').value}}));}
  catch(error){toast(error.message);}finally{pending=false;$('create-button').disabled=false;if(session)render();}
});
$('join-form').addEventListener('submit',async event=>{
  event.preventDefault();if(pending)return;
  const room=$('room-code').value.trim().toUpperCase();
  if(!/^[A-Z2-9]{8}$/.test(room))return toast('Enter the eight-character room code.');
  pending=true;const button=event.submitter;button.disabled=true;
  try{if(seats[room])await reconnect(seats[room]);else await enter(await api('/api/rooms/'+room+'/join',{method:'POST',auth:null,data:{name:$('player-name').value}}));}
  catch(error){toast(error.message);}finally{pending=false;button.disabled=false;if(session)render();}
});
$('invite-button').addEventListener('click',async()=>{
  const link=location.origin+'/?room='+session.room;
  try{await navigator.clipboard.writeText(link);toast('Invite link copied. Share it with your friends.');}
  catch{window.prompt('Copy this invite link:',link);}
});
$('rules-button').addEventListener('click',openRules);
$('offer-button').addEventListener('click',openTrade);
$('home-button').addEventListener('click',leaveView);
$('cancel-tool').addEventListener('click',()=>{tool=null;moveFrom=null;render();});
$('rules-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const rules=$('use-rule-json').checked?JSON.parse($('rules-json').value):{...game.rules,
      targetPoints:Number($('rule-target').value),bankTradeRatio:Number($('rule-ratio').value),discardLimit:Number($('rule-discard').value),
      futuresEnabled:$('rule-futures').checked,tradeOnAnyTurn:$('rule-anyturn').checked,preserveRoadConnections:$('rule-connections').checked,
      renovationCost:Object.fromEntries(R.map(r=>[r,Number($('renovation-'+r).value)]))};
    if(await send({type:'rules',rules}))$('rules-dialog').close();
  }catch(error){toast(error.message);}
});
$('trade-form').addEventListener('submit',async event=>{
  event.preventDefault();if(await send({type:'offer',to:$('trade-partner').value,give:tradeLeg('give'),want:tradeLeg('want')}))$('trade-dialog').close();
});
$('bank-form').addEventListener('submit',async event=>{
  event.preventDefault();if(await send({type:'bank',give:$('bank-give').value,receive:$('bank-receive').value,count:Number($('bank-count').value)}))$('bank-dialog').close();
});
['bank-give','bank-receive','bank-count'].forEach(id=>$(id).addEventListener('input',updateBankPreview));
$('discard-form').addEventListener('submit',async event=>{
  event.preventDefault();const cards=Object.fromEntries([...$('discard-fields').querySelectorAll('input')].map(input=>[input.dataset.resource,Number(input.value)]));
  await send({type:'discard',cards});
});
$('discard-dialog').addEventListener('cancel',event=>{if(game?.pendingDiscards[session?.playerId])event.preventDefault();});
$('development-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!selectedDev)return;
  const action={type:'play-development',card:selectedDev.id};
  if(selectedDev.type==='plenty')action.resources=[$('dev-first').value,$('dev-second').value];
  else action.resource=$('dev-resource').value;
  if(await send(action))$('development-dialog').close();
});
$('export-rules').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(game.rules,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download='cataan-house-rules.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('import-rules').addEventListener('change',async event=>{
  try{
    const file=event.target.files[0];if(!file)return;if(file.size>32768)throw Error('Rule packs must be smaller than 32 KB.');
    const rules=JSON.parse(await file.text());$('rules-json').value=JSON.stringify(rules,null,2);$('use-rule-json').checked=true;
    toast('Rule pack loaded. Review it and save to apply.');
  }catch(error){toast(error.message);}finally{event.target.value='';}
});
const invitation=new URLSearchParams(location.search).get('room')?.toUpperCase();
if(invitation)$('room-code').value=invitation;
let savedRoom=invitation;
try{savedRoom ||= localStorage.getItem('cataan_current_v1');}catch{}
if(savedRoom&&seats[savedRoom]?.token){
  try{await reconnect(seats[savedRoom]);}
  catch(error){toast(error.message+' You can join or create another table.');render();}
}else render();
setInterval(poll,1500);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
