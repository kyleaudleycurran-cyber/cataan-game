import { RESOURCES } from './rules.mjs';
export function shuffled(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function makeBoard(rng = Math.random) {
  const nodes = [], edges = [], tiles = [], nodeMap = new Map(), edgeMap = new Map();
  const terrain = shuffled(['wood','wood','wood','wood','wool','wool','wool','wool','grain','grain','grain','grain','brick','brick','brick','ore','ore','ore','desert'], rng);
  for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) {
    if (Math.abs(q + r) > 2) continue;
    const tile = { id: tiles.length, q, r, x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r, resource: terrain[tiles.length], number: null, nodes: [] };
    for (let k = 0; k < 6; k++) {
      const angle = (30 + 60 * k) * Math.PI / 180;
      const x = tile.x + Math.cos(angle), y = tile.y + Math.sin(angle);
      const key = Math.round(x * 10000) + ':' + Math.round(y * 10000);
      let id = nodeMap.get(key);
      if (id === undefined) {
        id = nodes.length;
        nodes.push({ id, x, y, tiles: [], edges: [], building: null, owner: null });
        nodeMap.set(key, id);
      }
      tile.nodes.push(id);
      nodes[id].tiles.push(tile.id);
    }
    for (let k = 0; k < 6; k++) {
      const a = tile.nodes[k], b = tile.nodes[(k + 1) % 6], key = [a,b].sort((x,y)=>x-y).join(':');
      let id = edgeMap.get(key);
      if (id === undefined) {
        id = edges.length;
        edges.push({ id, a, b, owner: null, tiles: [] });
        nodes[a].edges.push(id); nodes[b].edges.push(id); edgeMap.set(key, id);
      }
      edges[id].tiles.push(tile.id);
    }
    tiles.push(tile);
  }
  const numbers = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const bag = shuffled(numbers, rng);
    for (const t of tiles) t.number = t.resource === 'desert' ? null : bag.pop();
    const red = tiles.filter(t => t.number === 6 || t.number === 8);
    if (!red.some((t,i) => red.slice(i+1).some(u => Math.max(Math.abs(t.q-u.q),Math.abs(t.r-u.r),Math.abs(t.q+t.r-u.q-u.r))===1))) break;
  }
  const coast = edges.filter(e=>e.tiles.length===1).sort((a,b)=>{
    const angle = e => Math.atan2((nodes[e.a].y+nodes[e.b].y)/2,(nodes[e.a].x+nodes[e.b].x)/2);
    return angle(a)-angle(b);
  });
  const kinds = shuffled([null,null,null,null,...RESOURCES], rng);
  const ports = kinds.map((resource,i)=>({ edge: coast[Math.floor(i*coast.length/9)].id, resource, ratio: resource ? 2 : 3 }));
  return { nodes, edges, tiles, ports, robber: tiles.find(t=>t.resource==='desert').id };
}
export function otherNode(edge, node) { return edge.a === node ? edge.b : edge.a; }
export function roadLegal(s, playerId, edgeId) {
  const e = s.board.edges[edgeId];
  if (!e || e.owner) return false;
  return [e.a,e.b].some(id=>{
    const n=s.board.nodes[id];
    if (n.owner) return n.owner===playerId;
    return n.edges.some(i=>s.board.edges[i].owner===playerId);
  });
}
export function settlementLegal(s, playerId, nodeId, setup=false) {
  const n=s.board.nodes[nodeId];
  if (!n || n.owner) return false;
  if (n.edges.some(i=>s.board.nodes[otherNode(s.board.edges[i],nodeId)].owner)) return false;
  return setup || n.edges.some(i=>s.board.edges[i].owner===playerId);
}
export function longestRoad(s, playerId) {
  const own = s.board.edges.filter(e=>e.owner===playerId);
  const walk = (node, used) => {
    if (used.size && s.board.nodes[node].owner && s.board.nodes[node].owner!==playerId) return used.size;
    let best=used.size;
    for (const id of s.board.nodes[node].edges) {
      if (s.board.edges[id].owner!==playerId || used.has(id)) continue;
      const next=new Set(used); next.add(id);
      best=Math.max(best,walk(otherNode(s.board.edges[id],node),next));
    }
    return best;
  };
  return own.reduce((n,e)=>Math.max(n,walk(e.a,new Set()),walk(e.b,new Set())),0);
}
function components(s, playerId) {
  const map=new Map(); let label=0;
  for (const start of s.board.nodes) {
    if (map.has(start.id)) continue;
    const stack=[start.id]; label++;
    while(stack.length) {
      const id=stack.pop(); if(map.has(id))continue;
      map.set(id,label);
      for(const edgeId of s.board.nodes[id].edges) {
        const e=s.board.edges[edgeId]; if(e.owner===playerId)stack.push(otherNode(e,id));
      }
    }
  }
  return map;
}
export function moveRoadLegal(s, playerId, fromId, toId) {
  const from=s.board.edges[fromId], to=s.board.edges[toId];
  if(!from || !to || from.owner!==playerId || to.owner || fromId===toId)return false;
  const before=s.rules.preserveRoadConnections ? components(s,playerId):null;
  const anchors=new Set(s.board.nodes.filter(n=>n.owner===playerId).map(n=>n.id));
  for(const e of s.board.edges)if(e.owner===playerId && e.id!==fromId){anchors.add(e.a);anchors.add(e.b);}
  from.owner=null;
  try {
    if(!roadLegal(s,playerId,toId))return false;
    if(!before)return true;
    to.owner=playerId;
    try {
      const after=components(s,playerId), a=[...anchors];
      return a.every((v,i)=>a.slice(i+1).every(u=>before.get(v)!==before.get(u)||after.get(v)===after.get(u)));
    } finally {to.owner=null;}
  } finally {from.owner=playerId;}
}
