import './styles.css';
import {FILES,SOURCE_FILES,supportsFileAccess,permission,ensureFiles,readJsonl,writeText,serializeJsonl,saveHandle,loadHandle} from './file-system.js';
import {loadLabels,setLabel} from './channel-labels.js';
import {addHistory,lastHistory,removeHistory} from './history.js';
import {backup} from './backup.js';
import {render} from './ui.js';

const root=document.querySelector('#app');
// state.data は FILES 全件をメモリに保持。移動はメモリ更新→即描画→バックグラウンド書き込みの順で行う。
const state={handle:null,data:Object.fromEntries(FILES.map(n=>[n,{records:[],text:'',fingerprint:''}])),labels:{},file:'possible.jsonl',index:0,session:0,busy:false,syncing:false,ready:false,status:'',error:'',embed:false};
const show=()=>render(root,{...state,sourceFiles:SOURCE_FILES,current:state.data[state.file]?.records[state.index]},actions);
const message=(status='',error='')=>{state.status=status;state.error=error;show();};

// ---- バックグラウンド書き込みキュー（ファイル単位で最新値に集約） ----
// 同一ファイルへの連続書き込みは最新の内容だけを保持し、余分なI/Oを発生させない。
const writeQueue=new Map();
let writeDraining=false;
function enqueueWrite(name,text){writeQueue.set(name,text);if(!state.syncing){state.syncing=true;show();}if(!writeDraining)drainWrites();}
async function drainWrites(){
  writeDraining=true;
  while(writeQueue.size>0){
    const [name,text]=writeQueue.entries().next().value;
    writeQueue.delete(name);
    try{await writeText(state.handle,name,text);}
    catch(e){
      writeQueue.clear();writeDraining=false;state.syncing=false;
      message('',`ファイルの保存に失敗しました (${name}): ${e.message}\nデータが失われる可能性があります。バックアップを取得してください。`);
      return;
    }
  }
  writeDraining=false;state.syncing=false;show();
}

// ページを閉じる前にキューが残っていれば警告する
window.addEventListener('beforeunload',e=>{if(writeQueue.size>0||writeDraining){e.preventDefault();}});

async function reload(){const next={};for(const name of FILES)next[name]=await readJsonl(state.handle,name);state.data=next;state.labels=await loadLabels(state.handle);state.index=Math.min(state.index,Math.max(0,next[state.file].records.length-1));}
async function connect(handle,ask=false){if(!await permission(handle,ask))throw new Error('読み書き権限がありません。');const missing=await ensureFiles(handle,false);if(missing.length){if(!confirm(`ファイルが不足しています: ${missing.join(', ')}\n空ファイルを作成しますか？`))throw new Error('必要な分類先ファイルがありません。');await ensureFiles(handle,true);}state.handle=handle;await reload();state.ready=true;await saveHandle(handle);message('読み込み完了。');}
async function choose(){try{if(!supportsFileAccess())throw new Error('このブラウザはフォルダの直接更新に対応していません。');await connect(await window.showDirectoryPicker({mode:'readwrite'}),true);}catch(e){message('',e.name==='AbortError'?'フォルダ選択をキャンセルしました。':e.message);}}
function sameRecord(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function removeOne(records,record){const i=records.findIndex(x=>sameRecord(x,record));if(i<0)throw new Error('現在表示中のレコードが移動元に見つかりません。再読み込みしてください。');return records.filter((_,index)=>index!==i);}

// メモリを即時更新してから書き込みをキューイング。UIブロックなし。
function applyMoveInMemory(srcName,dstName,record){
  const newSrc=removeOne(state.data[srcName].records,record),newDst=[...state.data[dstName].records,record];
  const srcText=serializeJsonl(newSrc),dstText=serializeJsonl(newDst);
  state.data[srcName]={...state.data[srcName],records:newSrc,text:srcText};
  state.data[dstName]={...state.data[dstName],records:newDst,text:dstText};
  enqueueWrite(srcName,srcText);
  enqueueWrite(dstName,dstText);
}

async function move(destination){
  if(!state.ready)return;
  const sourceName=state.file,record=state.data[sourceName].records[state.index];
  if(!record)return;
  if(destination===sourceName){state.index=Math.min(state.index+1,state.data[sourceName].records.length-1);show();return;}
  try{
    applyMoveInMemory(sourceName,destination,record);
    state.index=Math.min(state.index,Math.max(0,state.data[sourceName].records.length-1));
    state.session++;
    show(); // ファイルI/O完了前に即描画
    await addHistory({source:sourceName,destination,record});
  }catch(e){message('',`移動に失敗しました: ${e.message}`);}
}

async function undo(){
  if(state.busy||!state.ready)return;
  state.busy=true;show();
  try{
    const h=await lastHistory();
    if(!h)throw new Error('取り消せる履歴はありません。');
    applyMoveInMemory(h.destination,h.source,h.record);
    await removeHistory(h.id);
    state.file=h.source;
    state.index=Math.max(0,state.data[h.source].records.length-1);
    message('直前の移動を取り消しました。');
  }catch(e){message('',`Undoできません: ${e.message}`);}
  finally{state.busy=false;show();}
}

function goTo(fileName, index){
  if(state.busy)return message('','処理中のため移動できません');
  if(!state.ready)return message('','データフォルダを選択してください');
  const list=state.data[fileName]?.records;
  if(!list||list.length===0)return message('','このファイルにはレコードがありません');
  if(!Number.isInteger(index)||index<0||index>=list.length){
    return message('',`1〜${list.length} の範囲で指定してください`);
  }
  state.file=fileName;
  state.index=index;
  state.embed=false;
  message(`${index+1} 件目に移動しました。`);
}

async function label(value){const record=state.data[state.file].records[state.index];try{state.labels=await setLabel(state.handle,record,value==='clear'?null:value==='true');message('チャンネル判定を保存しました。');}catch(e){message('',e.message);}}
async function downloadBackup(){try{const blob=await backup(state.handle),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`music-selector-backup-${new Date().toISOString().slice(0,10)}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);message('バックアップを作成しました。');}catch(e){message('',e.message);}}
const actions={choose,file:n=>{state.file=n;state.index=0;state.embed=false;message('ファイルを切り替えました。');},move,undo,label,backup:downloadBackup,embed:()=>{state.embed=!state.embed;show();},jump:n=>goTo(state.file,n-1),goToIndex:idx=>goTo(state.file,idx),stepIndex:delta=>goTo(state.file,state.index+delta)};
if('serviceWorker'in navigator){if(location.hostname==='localhost'||location.hostname==='127.0.0.1')navigator.serviceWorker.getRegistrations().then(items=>Promise.all(items.map(item=>item.unregister())));else navigator.serviceWorker.register('/sw.js').catch(()=>{});}
if(supportsFileAccess())loadHandle().then(async h=>{if(h&&await permission(h,false))await connect(h,false);else show();}).catch(()=>show());else message('', 'このブラウザでは直接ファイルを編集できません。');
show();
