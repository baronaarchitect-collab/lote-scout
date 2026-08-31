// Servidor estático mínimo para la app (sin dependencias)
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = process.env.PORT || 5178;
const types = {'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  let f = decodeURIComponent(req.url.split('?')[0]);
  if(f==='/') f='/index.html';
  const p = path.join(root,f);
  if(!p.startsWith(root)){res.writeHead(403);return res.end();}
  fs.readFile(p,(e,data)=>{
    if(e){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':types[path.extname(p).toLowerCase()]||'application/octet-stream'});
    res.end(data);
  });
}).listen(port,()=>console.log('Trazador de Lotes → http://localhost:'+port));
