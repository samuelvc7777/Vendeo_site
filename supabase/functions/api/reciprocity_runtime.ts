import {OpenAiReciprocityProvider, type OpenAiReciprocityOptions} from './reciprocity_openai.ts';
import {SupabaseReciprocityStore} from './reciprocity_repository.ts';
import {ReciprocityService,type ReciprocityScope} from './reciprocity_service.ts';
import {authenticateReciprocityScope} from './reciprocity_auth.ts';
import {handleReciprocityRequest} from './reciprocity_routes.ts';
import {handleReciprocityEvents} from './reciprocity_events.ts';

export async function handleReciprocityApi({request,path,supabase,scopesJson,providerOptions,corsHeaders}: {
  request: Request; path: string; supabase: any; scopesJson: string;
  providerOptions: OpenAiReciprocityOptions; corsHeaders: Record<string,string>;
}): Promise<Response> {
  if(path !== '/operator/reciprocity/events') {
    return handleReciprocityRequest({request,path,scopesJson,corsHeaders,service:createReciprocityService(supabase,providerOptions)});
  }
  let authorizedScope:ReciprocityScope;
  const store=new SupabaseReciprocityStore(supabase);
  return handleReciprocityEvents({request,corsHeaders,
    authorize:async (req,id)=>{
      authorizedScope=await authenticateReciprocityScope(req,scopesJson);
      return store.authorize(authorizedScope,id);
    },
    subscribe:async (id,onChange,onError)=>new Promise<()=>void>((resolve,reject)=>{
      let subscribed=false;
      let removed=false;
      const channel=supabase.channel(`reciprocity:${crypto.randomUUID()}`).on('postgres_changes',{
        event:'*',schema:'public',table:'reciprocity_attempts',filter:`conversation_id=eq.${id}`,
      },(payload:{new?:{scope_id?:string;conversation_id?:string}})=>{
        if(payload.new?.scope_id===authorizedScope.scopeId && payload.new?.conversation_id===id)onChange();
      });
      const cleanup=()=>{
        if(removed)return;
        removed=true;
        void Promise.resolve(supabase.removeChannel(channel)).catch(()=>{});
      };
      const timeout=setTimeout(()=>{cleanup();reject(new Error('Realtime indisponível.'));},8000);
      channel.subscribe((status:string)=>{
        if(removed)return;
        if(status==='SUBSCRIBED'){
          clearTimeout(timeout);
          subscribed=true;
          resolve(cleanup);
        } else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
          clearTimeout(timeout);
          if(subscribed)onError();
          else {cleanup();reject(new Error('Realtime indisponível.'));}
        }
      });
    }),
  });
}

export function createReciprocityService(supabase:any,options:OpenAiReciprocityOptions){
  return new ReciprocityService(new SupabaseReciprocityStore(supabase),new OpenAiReciprocityProvider(options));
}
/** Chamado por cron autenticado. Uma reserva por invocação; sem loops de polling. */
export async function processReciprocityQueue({supabase,openAiKey,scopes,providerOptions={}}:{
  supabase:any;openAiKey:string;scopes:ReciprocityScope[];providerOptions?:Omit<OpenAiReciprocityOptions,'apiKey'>;
}){
  const service=createReciprocityService(supabase,{...providerOptions,apiKey:openAiKey});
  return {processed:await service.processOne(scopes)};
}
