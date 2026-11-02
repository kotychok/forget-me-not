// Synthetic, reproducible content only. CPU times vary by machine; no server/data access.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
function id(seed) {
  const bytes = createHash('sha256').update(String(seed)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const phrases = ['Read the next chapter', 'Переглянути нотатки', 'Plan a small project', 'Collect useful links', 'Review language practice'];
console.log('| Items | Edit | JSON bytes | Gzip bytes | Reduction | Encode wall ms |');
console.log('| --- | --- | ---: | ---: | ---: | ---: |');
for (const size of [100, 1000, 3000, 5000]) {
  const nodes = Array.from({length:size},(_,i)=>({id:id(i),kind:i%3?'item':'task',text:`${phrases[i%phrases.length]} ${createHash('sha256').update(`text-${i}`).digest('hex').slice(0,24)}`,completed:false,children:[]}));
  for (const edit of ['text','indent','outdent']) {
    const copy=structuredClone(nodes);
    if(edit==='text') copy[Math.floor(size/2)].text+=' — edited';
    else if (edit === 'indent') copy[Math.floor(size/2)-1].children.push(copy.splice(Math.floor(size/2),1)[0]);
    else {
      const at = Math.floor(size/2);
      copy[at-1].children.push(copy.splice(at,1)[0]);
      copy.splice(at,0,copy[at-1].children.pop());
    }
    const body=JSON.stringify({document:{id:id('list'),title:'Synthetic transfer benchmark',nodes:copy},baseRevision:1});
    const bytes=new TextEncoder().encode(body);
    const start=performance.now();
    const compressed=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    console.log(`| ${size} | ${edit} | ${bytes.length} | ${compressed.byteLength} | ${(100-100*compressed.byteLength/bytes.length).toFixed(1)}% | ${(performance.now()-start).toFixed(2)} |`);
  }
}
