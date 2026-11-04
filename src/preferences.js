const KEY='music-selector:sort-spec';
export function createPreferences(storage=window.localStorage){return {loadSortSpec(){try{const value=storage.getItem(KEY);return typeof value==='string'&&value.startsWith('v1;')?value.slice(3):'';}catch{return '';}},saveSortSpec(spec){try{storage.setItem(KEY,`v1;${spec||''}`);}catch{}}};}
