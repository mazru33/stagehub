const limits={q:100,city:100,level:80,category:180};
export function filtersFromQuery(query){const params=new URLSearchParams(query);return {...Object.fromEntries(Object.entries(limits).map(([key,max])=>[key,String(params.get(key)||'').slice(0,max)])),emailOnly:params.get('email')==='1'};}
export function queryFromFilters(filters){const params=new URLSearchParams();for(const key of Object.keys(limits)){const value=String(filters[key]||'').trim();if(value)params.set(key,value.slice(0,limits[key]));}if(filters.emailOnly)params.set('email','1');return params.toString();}
