import http from 'node:http';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../supabase/templates/confirmation.html',import.meta.url),'utf8');
if((source.match(/{{ \.Token }}/g)||[]).length!==1 || (source.match(/{{ \.ConfirmationURL }}/g)||[]).length!==2) throw new Error('Missing confirmation template variables');
const html=source.replaceAll('{{ .Token }}','123456').replaceAll('{{ .ConfirmationURL }}','#preview-only');
const port=Number(process.env.PORT||5019);
http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);}).listen(port,'127.0.0.1',()=>console.log(`Synthetic email preview: http://127.0.0.1:${port}`));
