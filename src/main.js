import './styles.css';
import {FILES,SOURCE_FILES,supportsFileAccess,permission,ensureFiles,readJsonl,writeText,serializeJsonl,saveHandle,loadHandle} from './file-system.js';
import {loadLabels,setLabel} from './channel-labels.js';
import {addHistory,lastHistory,removeHistory} from './history.js';
import {backup} from './backup.js';
import {render} from './ui.js';
import {SORT_PRESETS,normalizeSpec,parseSpecString,serializeSpec,reverseSpec,findPresetId} from './sort.js';
import {buildOrder,invertOrder} from './view-order.js';
import {getVideoId} from './record-fields.js';
import {createPreferences} from './preferences.js';

const root=document.querySelector('#app'),preferences=createPreferences();
const state={handle:null,data:Object.fromEntries(FILES.map(n=>[n,{records:[],text:'',fingerprint:''}])),labels:{},file:'possible.jsonl',index:0,session:0,busy:false,syncing:false,ready:false,status:'',error:'',embed:false,search:{query:'',fields:{videoId:false,title:true,channel:true},scope:'all'},view:{spec:[],order:{},inverse:{}}};
function rebuildView(...names){for(const name of names){const order=buildOrder(state.data[name]?.records||[],state.view.spec);state.view.order[name]=order;state.view.inverse[name]=invertOrder(order);}}
const viewLength=file=>state.view.order[file]?.length||0;
const getRecordAt=(file,viewIndex)=>{const i=state.view.order[file]?.[viewIndex];return Number.isInteger(i)?state.data[file]?.records[i]||null:null;};
const getCurrentRecord=()=>getRecordAt(state.file,state.index);
function locateByVideoId(videoId){if(!videoId)return null;for(const file of FILES){const dataIndex=state.data[file].records.findIndex(r=>getVideoId(r)===videoId);if(dataIndex>=0)return {file,viewIndex:state.view.inverse[file]?.[dataIndex],dataIndex};}return null;}
const show=()=>render(root,{...state,sourceFiles:SOURCE_FILES,current:getCurrentRecord(),viewLength:viewLength(state.file),sort:{presets:SORT_PRESETS.map(({id,label})=>({id,label})),currentId:findPresetId(state.view.spec)}},actions);
const message=(status='',error='')=>{state.status=status;state.error=error;show();};

const writeQueue=new Map();let writeDraining=false;
function enqueueWrite(name,text){writeQueue.set(name,text);if(!state.syncing){state.syncing=true;show();}if(!writeDraining)drainWrites();}
async function drainWrites(){writeDraining=true;while(writeQueue.size){const [name,text]=writeQueue.entries().next().value;writeQueue.delete(name);try{await writeText(state.handle,name,text);}catch(error){writeQueue.clear();writeDraining=false;state.syncing=false;message('',`ファイルの保存に失敗しました (${name}): ${error.message}\nデータが失われる可能性があります。バックアップを取得してください。`);return;}}writeDraining=false;state.syncing=false;show();}
window.addEventListener('beforeunload',e=>{if(writeQueue.size||writeDraining)e.preventDefault();});
async function reload(){const next={};for(const name of FILES)next[name]=await readJsonl(state.handle,name);state.data=next;state.labels=await loadLabels(state.handle);state.view.spec=parseSpecString(preferences.loadSortSpec())||[];rebuildView(...FILES);state.index=Math.min(state.index,Math.max(0,viewLength(state.file)-1));}
async function connect(handle,ask=false){if(!await permission(handle,ask))throw new Error('読み書き権限がありません。');const missing=await ensureFiles(handle,false);if(missing.length){if(!confirm(`ファイルが不足しています: ${missing.join(', ')}\n空ファイルを作成しますか？`))throw new Error('必要な分類先ファイルがありません。');await ensureFiles(handle,true);}state.handle=handle;await reload();state.ready=true;await saveHandle(handle);message('読み込み完了。');}
async function choose(){try{if(!supportsFileAccess())throw new Error('このブラウザはフォルダの直接更新に対応していません。');await connect(await window.showDirectoryPicker({mode:'readwrite'}),true);}catch(error){message('',error.name==='AbortError'?'フォルダ選択をキャンセルしました。':error.message);}}
function removeOne(records,record){const i=records.findIndex(item=>item===record||JSON.stringify(item)===JSON.stringify(record));if(i<0)throw new Error('現在表示中のレコードが移動元に見つかりません。再読み込みしてください。');return records.filter((_,index)=>index!==i);}
function applyMoveInMemory(src,dst,record){const newSrc=removeOne(state.data[src].records,record),newDst=[...state.data[dst].records,record],srcText=serializeJsonl(newSrc),dstText=serializeJsonl(newDst);state.data[src]={...state.data[src],records:newSrc,text:srcText};state.data[dst]={...state.data[dst],records:newDst,text:dstText};rebuildView(src,dst);enqueueWrite(src,srcText);enqueueWrite(dst,dstText);}
async function move(destination){if(!state.ready)return;const source=state.file,record=getCurrentRecord();if(!record)return;if(destination===source){state.index=Math.min(state.index+1,viewLength(source)-1);show();return;}try{applyMoveInMemory(source,destination,record);state.index=Math.min(state.index,Math.max(0,viewLength(source)-1));state.session++;show();await addHistory({source,destination,record});}catch(error){message('',`移動に失敗しました: ${error.message}`);}}
async function undo(){if(state.busy||!state.ready)return;state.busy=true;show();try{const history=await lastHistory();if(!history)throw new Error('取り消せる履歴はありません。');applyMoveInMemory(history.destination,history.source,history.record);await removeHistory(history.id);const found=locateByVideoId(getVideoId(history.record));if(!found)throw new Error('復元したレコードを見つけられません。');state.file=found.file;state.index=found.viewIndex;message('直前の移動を取り消しました。');}catch(error){message('',`Undoできません: ${error.message}`);}finally{state.busy=false;show();}}
/** viewIndex は表示位置（0始まり）。 */
function goTo(file,viewIndex){if(state.busy)return message('','処理中のため移動できません');if(!state.ready)return message('','データフォルダを選択してください');const length=viewLength(file);if(!length)return message('','このファイルにはレコードがありません');if(!Number.isInteger(viewIndex)||viewIndex<0||viewIndex>=length)return message('',`1〜${length} の範囲で指定してください`);state.file=file;state.index=viewIndex;state.embed=false;message(`${viewIndex+1} 件目に移動しました。`);}
function setSort(spec){if(state.busy)return message('','処理中のため並び順を変更できません');const normalized=normalizeSpec(spec);if(normalized===null)return message('','並び順の指定が不正です');const id=getVideoId(getCurrentRecord());state.view.spec=normalized;rebuildView(...FILES);const found=locateByVideoId(id);if(found){state.file=found.file;state.index=found.viewIndex;}else state.index=0;preferences.saveSortSpec(serializeSpec(normalized));message('並び順を変更しました。');}
async function label(value){try{state.labels=await setLabel(state.handle,getCurrentRecord(),value==='clear'?null:value==='true');message('チャンネル判定を保存しました。');}catch(error){message('',error.message);}}
async function downloadBackup(){try{const blob=await backup(state.handle),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`music-selector-backup-${new Date().toISOString().slice(0,10)}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);message('バックアップを作成しました。');}catch(error){message('',error.message);}}
const actions={choose,file:name=>{state.file=name;state.index=0;state.embed=false;message('ファイルを切り替えました。');},move,undo,label,backup:downloadBackup,embed:()=>{state.embed=!state.embed;show();},jump:n=>goTo(state.file,n-1),goToIndex:i=>goTo(state.file,i),stepIndex:d=>goTo(state.file,state.index+d),openResult:(file,index)=>goTo(file,index),setSearch:partial=>{Object.assign(state.search,partial);show();},setSort:value=>{const preset=SORT_PRESETS.find(p=>p.id===value);setSort(preset?.spec||value);},reverseSort:()=>setSort(reverseSpec(state.view.spec))};
if('serviceWorker'in navigator){if(location.hostname==='localhost'||location.hostname==='127.0.0.1')navigator.serviceWorker.getRegistrations().then(items=>Promise.all(items.map(item=>item.unregister())));else navigator.serviceWorker.register('/sw.js').catch(()=>{});}
if(supportsFileAccess())loadHandle().then(async handle=>{if(handle&&await permission(handle,false))await connect(handle,false);else show();}).catch(()=>show());else message('','このブラウザでは直接ファイルを編集できません。');
show();
