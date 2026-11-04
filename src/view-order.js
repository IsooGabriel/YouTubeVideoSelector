import {normalizeSpec,getSortValues,compareValues} from './sort.js';

export function buildOrder(records,spec){const normalized=normalizeSpec(spec);const order=records.map((_,index)=>index);if(!normalized?.length)return order;const values=records.map(record=>getSortValues(record,normalized));return order.sort((a,b)=>{for(let i=0;i<normalized.length;i++){const rule=normalized[i],left=values[a][i],right=values[b][i];let result=compareValues(left.value,right.value,rule.dir);if(!result&&rule.key==='channel')result=compareValues(left.tie,right.tie,rule.dir);if(result)return result;}return a-b;});}
export function invertOrder(order){const inverse=[];order.forEach((dataIndex,viewIndex)=>{inverse[dataIndex]=viewIndex;});return inverse;}
