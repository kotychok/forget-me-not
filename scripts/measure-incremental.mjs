// Synthetic inputs only; compare the actual planner against M14 gzip snapshots.
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { planChanges } from '../frontend/src/lib/incremental.ts';
console.log('| Items | Edit | Snapshot gzip bytes | Selected delta bytes | Reduction | Plan ms |');
console.log('| ---: | --- | ---: | ---: | ---: | ---: |');
for (const size of [100, 1000, 3000, 5000]) {
  const base = { id: randomUUID(), title: 'Synthetic', nodes: Array.from({length:size}, (_,i)=>({id:randomUUID(),kind:'item',text:`Synthetic ${i} ${createHash('sha256').update(String(i)).digest('hex').slice(0,24)}`,completed:false,children:[]})) };
  for (const edit of ['text','branch move']) {
    const target=structuredClone(base);
    if(edit==='text') target.nodes[Math.floor(size/2)].text+=' edited';
    else target.nodes[0].children.push(target.nodes.splice(1,1)[0]);
    const start=performance.now();
    const packet=planChanges(base,target,1,randomUUID());
    const elapsed=performance.now()-start;
    if(!packet) throw new Error('Expected incremental packet');
    const full=gzipSync(JSON.stringify({document:target,baseRevision:1})).length;
    const text=JSON.stringify(packet);
    const delta=Math.min(Buffer.byteLength(text),gzipSync(text).length);
    // Small packets are sent plain under the existing 8-KiB compression threshold.
    const selected=Buffer.byteLength(text)<8192 ? Buffer.byteLength(text) : delta;
    console.log(`| ${size} | ${edit} | ${full} | ${selected} | ${(100-100*selected/full).toFixed(1)}% | ${elapsed.toFixed(2)} |`);
  }
}
