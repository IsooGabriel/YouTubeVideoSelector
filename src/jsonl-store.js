export class JsonlError extends Error { constructor(message, file, line) { super(message); this.file=file; this.line=line; } }
export function parseJsonl(text, file='') {
  const records=[]; const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  lines.forEach((line,index)=>{ if(!line.trim()) return; try { const value=JSON.parse(line); if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('JSONオブジェクトではありません'); records.push(value); } catch(e) { throw new JsonlError(`${file} の ${index+1} 行目を解析できません: ${e.message}`,file,index+1); }});
  return records;
}
export const serializeJsonl=records=>records.map(x=>JSON.stringify(x)).join('\n')+(records.length?'\n':'');
export async function fingerprint(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function validateUnique(files) { const seen=new Map(), duplicates=[]; for(const [file,records] of Object.entries(files)) for(const r of records) { if(typeof r.video_id!=='string'||!r.video_id) continue; if(seen.has(r.video_id)) duplicates.push({video_id:r.video_id,files:[seen.get(r.video_id),file]}); else seen.set(r.video_id,file); } return duplicates; }
export function planMove(source, destination, target) { const hasId=typeof target==='string'; const key=hasId?target:JSON.stringify(target); const matches=r=>hasId?r.video_id===key:JSON.stringify(r)===key; const found=source.filter(matches), existing=destination.filter(matches); if(found.length!==1) throw new Error(hasId?`移動元に video_id=${key} がちょうど1件存在する必要があります。`:'video_idのないレコードを一意に特定できません。'); if(existing.length) throw new Error(hasId?`移動先に video_id=${key} が既に存在します。`:'同一内容のレコードが移動先に既に存在します。'); const index=source.indexOf(found[0]); return {record:found[0], source:source.filter((_,i)=>i!==index), destination:[...destination,found[0]]}; }
