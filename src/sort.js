import {getTitle,getChannel,getChannelUrl,getArtist,getLastPlayed,getFirstPlayed,getPlayCount} from './record-fields.js';

export const SORT_KEYS={
  title:{label:'曲名',type:'text',getValue:r=>toSortText(getTitle(r))},
  channel:{label:'チャンネル',type:'text',getValue:r=>toSortText(getChannel(r)),getTie:r=>getChannelUrl(r)||null},
  artist:{label:'アーティスト',type:'text',getValue:r=>toSortText(getArtist(r))},
  last_played:{label:'最終再生日',type:'date',getValue:getLastPlayed},
  first_played:{label:'初回再生日',type:'date',getValue:getFirstPlayed},
  play_count:{label:'再生回数',type:'number',getValue:getPlayCount},
};
export const SORT_PRESETS=[
  {id:'original',label:'ファイル順',spec:[]},
  {id:'title_asc',label:'曲名 A→Z',spec:[{key:'title',dir:'asc'}]},
  {id:'title_desc',label:'曲名 Z→A',spec:[{key:'title',dir:'desc'}]},
  {id:'recent',label:'最終再生日が新しい順',spec:[{key:'last_played',dir:'desc'},{key:'title',dir:'asc'}]},
  {id:'oldest',label:'最終再生日が古い順',spec:[{key:'last_played',dir:'asc'},{key:'title',dir:'asc'}]},
  {id:'first_played_asc',label:'初回再生日が古い順',spec:[{key:'first_played',dir:'asc'},{key:'title',dir:'asc'}]},
  {id:'channel_title',label:'チャンネル → 曲名',spec:[{key:'channel',dir:'asc'},{key:'title',dir:'asc'}]},
  {id:'artist_title',label:'アーティスト → 曲名',spec:[{key:'artist',dir:'asc'},{key:'title',dir:'asc'}]},
  {id:'most_played',label:'再生回数が多い順',spec:[{key:'play_count',dir:'desc'},{key:'title',dir:'asc'}]},
];
export function toSortText(value){const text=String(value??'').normalize('NFKC').toLowerCase().trim();const stripped=text.replace(/^[\p{P}\p{S}\p{Z}\uFE0F\u200D]+/u,'');const out=stripped||text;return out===''?null:out;}
export function normalizeSpec(spec){if(!Array.isArray(spec)||spec.length>3)return null;const seen=new Set(),out=[];for(const item of spec){if(!item||typeof item!=='object'||!SORT_KEYS[item.key]||(item.dir!=='asc'&&item.dir!=='desc')||seen.has(item.key))return null;seen.add(item.key);out.push({key:item.key,dir:item.dir});}return out;}
export function serializeSpec(spec){const normalized=normalizeSpec(spec);return normalized===null?'':normalized.map(({key,dir})=>`${key}:${dir}`).join(',');}
export function parseSpecString(value){if(value==='')return [];if(typeof value!=='string')return null;const parts=value.split(',');if(!parts.length||parts.some(part=>!part))return null;return normalizeSpec(parts.map(part=>{const [key,dir,...extra]=part.split(':');return extra.length?null:{key,dir};}));}
export function reverseSpec(spec){const normalized=normalizeSpec(spec);return normalized===null?null:normalized.map(({key,dir})=>({key,dir:dir==='asc'?'desc':'asc'}));}
export function findPresetId(spec){const serialized=serializeSpec(spec);return SORT_PRESETS.find(preset=>serializeSpec(preset.spec)===serialized)?.id||null;}
const cache=new WeakMap();
export function getSortValues(record,spec){const normalized=normalizeSpec(spec)||[];let values=cache.get(record);if(!values){values=new Map();cache.set(record,values);}return normalized.map(({key})=>{if(!values.has(key)){const entry=SORT_KEYS[key];values.set(key,{value:entry.getValue(record),tie:entry.getTie?.(record)??null});}return values.get(key);});}
export function compareValues(a,b,dir){const an=a==null,bn=b==null;if(an||bn)return an===bn?0:an?1:-1;const base=a<b?-1:a>b?1:0;return dir==='desc'?-base:base;}
