import {createClient} from '@supabase/supabase-js';

// Simula somente o transporte PostgREST: os RPCs, filtros e persistência executam SQL real.
export function pgliteSupabase(db){
  const identifier=value=>{if(!/^[a-z_][a-z_0-9]*$/.test(value))throw new Error(`Identificador SQL não permitido: ${value}`);return `"${value}"`;};
  return createClient('https://database.test','test-service-role',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init={})=>{
    const url=new URL(input), parts=url.pathname.split('/').filter(Boolean);
    try{
      let data;
      if(parts.at(-2)==='rpc'){
        const name=parts.at(-1),args=JSON.parse(init.body||'{}');
        const entries=Object.entries(args),params=entries.map(([,value])=>value!==null&&typeof value==='object'?JSON.stringify(value):value);
        const named=entries.map(([key],index)=>`${identifier(key)} => $${index+1}`).join(',');
        const setReturning=name==='pending_reciprocity_automatic_events';
        const result=await db.query(setReturning?`select * from ${identifier(name)}(${named})`:`select ${identifier(name)}(${named}) as value`,params);
        data=setReturning?result.rows:result.rows[0]?.value;
      }else{
        const table=identifier(parts.at(-1));
        if((init.method||'GET')!=='GET')throw new Error('Este teste só permite SELECT e RPC.');
        const select=url.searchParams.get('select')||'*';
        const columns=select==='*'?'*':select.split(',').map(identifier).join(',');
        const params=[],filters=[];
        for(const [key,value] of url.searchParams){
          if(['select','order','offset','limit'].includes(key))continue;
          if(!value.startsWith('eq.'))throw new Error(`Filtro não suportado: ${value}`);
          params.push(value.slice(3));filters.push(`${identifier(key)} = $${params.length}`);
        }
        let sql=`select ${columns} from ${table}${filters.length?' where '+filters.join(' and '):''}`;
        const order=url.searchParams.get('order');
        if(order)sql+=' order by '+order.split(',').map(value=>{const [column,direction]=value.split('.');if(!['asc','desc'].includes(direction))throw new Error('Ordenação inválida');return `${identifier(column)} ${direction}`;}).join(',');
        for(const key of ['limit','offset'])if(url.searchParams.has(key)){const value=Number(url.searchParams.get(key));if(!Number.isSafeInteger(value)||value<0)throw new Error('Paginação inválida');sql+=` ${key} ${value}`;}
        data=(await db.query(sql,params)).rows;
      }
      return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    }catch(error){return new Response(JSON.stringify({message:error.message,code:error.code||'TEST_SQL_ERROR'}),{status:400,headers:{'Content-Type':'application/json'}});}
  }}});
}
