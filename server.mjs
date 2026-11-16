import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, addPlayer, applyAction, viewGame } from './src/game.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const rng=()=>randomInt(0,0x100000000)/0x100000000;
const code=()=>[...randomBytes(8)].map(n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');
const token=()=>randomBytes(32).toString('base64url');
function reply(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(data===undefined?'':JSON.stringify(data));
}
async function body(req) {
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw Object.assign(Error('Send JSON.'),{status:415});
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)throw Object.assign(Error('Request too large.'),{status:413});chunks.push(chunk);}
  try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}
  catch{throw Object.assign(Error('Invalid JSON object.'),{status:400});}
}
export async function createServer({dataDirectory=process.env.DATA_DIR||join(ROOT,'data'),random=rng}={}) {
  await mkdir(dataDirectory,{recursive:true});
  const rooms=new Map(),limits=new Map();
  for(const file of await readdir(dataDirectory))if(/^[A-Z2-9]{8}\.json$/.test(file)){
    try{
      const room=JSON.parse(await readFile(join(dataDirectory,file),'utf8'));
      if(room.state?.schema===1&&room.members&&room.code===file.slice(0,-5))rooms.set(room.code,room);
    }catch{console.warn('Skipped unreadable room snapshot: '+file);}
  }
  function persist(room) {
    const snapshot=JSON.stringify({code:room.code,state:room.state,members:room.members});
    const path=join(dataDirectory,room.code+'.json');
    room.write=(room.write||Promise.resolve()).catch(()=>{}).then(async()=>{
      await writeFile(path+'.tmp',snapshot,{mode:0o600});await rename(path+'.tmp',path);
    });
    return room.write;
  }
  function limit(req) {
    const ip=req.socket.remoteAddress||'local',now=Date.now();
    let item=limits.get(ip);
    if(!item||now-item.start>60000){item={start:now,count:0};limits.set(ip,item);}
    if(++item.count>120)throw Object.assign(Error('Too many requests. Try again in a minute.'),{status:429});
    if(limits.size>10000)for(const [key,value]of limits)if(now-value.start>60000)limits.delete(key);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/api/health')return reply(res,200,{ok:true});
      if(req.method==='POST'){
        limit(req);
        const origin=req.headers.origin;
        if(origin&&new URL(origin).host!==req.headers.host)throw Object.assign(Error('Cross-origin requests are not allowed.'),{status:403});
      }
      if(req.method==='POST'&&url.pathname==='/api/rooms'){
        const input=await body(req);if(rooms.size>=1000)throw Error('This server has reached its room limit.');
        let roomCode=code();while(rooms.has(roomCode))roomCode=code();
        const secret=token(),room={code:roomCode,state:createGame('p1',input.name,input.rules||{},random),members:{[secret]:'p1'}};
        rooms.set(roomCode,room);
        try{await persist(room);}catch(error){rooms.delete(roomCode);throw error;}
        return reply(res,201,{room:roomCode,token:secret,playerId:'p1',game:viewGame(room.state,'p1')});
      }
      const match=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})(\/join|\/actions)?$/);
      if(match) {
        const room=rooms.get(match[1]);if(!room)return reply(res,404,{error:'Room not found. Check the code and server.'});
        if(req.method==='POST'&&match[2]==='/join'){
          const input=await body(req),id='p'+(room.state.players.length+1),secret=token();
          room.state=addPlayer(room.state,id,input.name);room.members[secret]=id;await persist(room);
          return reply(res,201,{room:room.code,token:secret,playerId:id,game:viewGame(room.state,id)});
        }
        const secret=(req.headers.authorization||'').replace(/^Bearer /,'');
        if(!Object.hasOwn(room.members,secret))return reply(res,401,{error:'This seat is not authorized. Join the room first.'});
        const id=room.members[secret];
        if(req.method==='GET'&&!match[2]){
          if(url.searchParams.get('since')===String(room.state.revision))return reply(res,204);
          return reply(res,200,{room:room.code,game:viewGame(room.state,id)});
        }
        if(req.method==='POST'&&match[2]==='/actions'){
          const input=await body(req);
          if(!Number.isInteger(input.revision)||input.revision!==room.state.revision)return reply(res,409,{error:'The table changed. Your view has been refreshed; try that action again.',game:viewGame(room.state,id)});
          room.state=applyAction(room.state,id,input.action,random);await persist(room);
          return reply(res,200,{room:room.code,game:viewGame(room.state,id)});
        }
        return reply(res,405,{error:'Method not allowed.'});
      }
      const assets={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.mjs':['app.mjs','text/javascript'],'/styles.css':['styles.css','text/css']};
      if((req.method==='GET'||req.method==='HEAD')&&Object.hasOwn(assets,url.pathname)){
        const [file,mime]=assets[url.pathname],content=await readFile(join(ROOT,'public',file));
        res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-cache'});
        return res.end(req.method==='HEAD'?undefined:content);
      }
      reply(res,404,{error:'Not found.'});
    }catch(error){
      const status=error.status||((error.code&&error.code.startsWith('E'))?500:400);
      if(status===500)console.error('Room storage failed:',error.code);
      if(!res.headersSent)reply(res,status,{error:status===500?'The server could not save this room. Check the server storage.':error.message});
      else res.end();
    }
  });
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=await createServer();
  const port=Number(process.env.PORT||3000);
  server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log('Cataan House Table listening on port '+server.address().port));
}
