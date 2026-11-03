import {authenticateReciprocityScope} from './reciprocity_auth.ts';
import {ReciprocityError, type ReciprocityService} from './reciprocity_service.ts';

async function requestBody(request:Request){
  const raw=await request.text();
  if(raw.length>4096)throw new ReciprocityError('Solicitação muito grande.',413);
  try{return JSON.parse(raw);}catch{throw new ReciprocityError('JSON inválido.');}
}

export async function handleReciprocityRequest({request,path,scopesJson,service,corsHeaders}: {
  request:Request; path:string; scopesJson:string; service:ReciprocityService; corsHeaders:Record<string,string>;
}):Promise<Response>{
  const headers={...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'};
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
  try {
    const scope=await authenticateReciprocityScope(request,scopesJson);
    const url=new URL(request.url);
    if(path==='/operator/reciprocity/settings'){
      if(request.method==='GET')return json(await service.getSettings(scope));
      if(request.method==='PUT')return json(await service.saveSettings(scope,await requestBody(request)));
      return json({error:'Método não permitido.'},405);
    }
    if(path==='/operator/reciprocity/evidence' && request.method==='GET')
      return json(await service.evidence(scope,url.searchParams.get('conversationId')||'',url.searchParams.get('attemptId')||'',url.searchParams.get('messageId')||''));
    if(path!=='/operator/reciprocity') return json({error:'Rota inexistente.'},404);
    if(request.method==='GET') return json(await service.view(scope,url.searchParams.get('conversationId')||''));
    if(request.method==='POST'){
      const body=await requestBody(request);
      if(typeof body?.conversationId!=='string'||body.conversationId.length>250) throw new ReciprocityError('Conversa inválida.');
      // Disparo automático é exclusivamente interno; cliente não escolhe escopo.
      const reason=body.reason || 'manual';
      if(!['manual','retry','reevaluation'].includes(reason)) throw new ReciprocityError('Motivo inválido.');
      return json(await service.request(scope,body.conversationId,reason),202);
    }
    return json({error:'Método não permitido.'},405);
  }catch(error){
    if(error instanceof ReciprocityError) return json({error:error.message},error.status);
    // Erros PostgREST podem conter dados; não devolvê-los ao cliente nem registrá-los.
    return json({error:'Não foi possível consultar ou solicitar a análise.'},500);
  }
}
