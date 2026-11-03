import {OpenAiReciprocityProvider, type OpenAiReciprocityOptions} from './reciprocity_openai.ts';
import {SupabaseReciprocityStore} from './reciprocity_repository.ts';
import {ReciprocityError, type ReciprocityScope} from './reciprocity_service.ts';

/** Uma passagem limitada por invocação do cron autenticado; sem mensagens ou polling no atendimento. */
export async function processReciprocityAutomaticEvents({supabase,scopes,openAiKey,providerOptions={}}:{
  supabase:any;scopes:ReciprocityScope[];openAiKey:string;providerOptions?:Omit<OpenAiReciprocityOptions,'apiKey'>;
}) {
  const counts={enqueued:0,failed:0,deferred:0};
  if(!openAiKey||scopes.length===0)return counts;
  const store=new SupabaseReciprocityStore(supabase);
  const provider=new OpenAiReciprocityProvider({...providerOptions,apiKey:openAiKey});
  for(const scope of scopes){
    const {data:events,error}=await supabase.rpc('pending_reciprocity_automatic_events',{
      p_scope_id:scope.scopeId,p_limit:20,p_scope:scope,
    });
    if(error)throw new ReciprocityError('Não foi possível consultar marcos de análise.',503);
    for(const event of events||[]){
      const id=event.conversation_id;
      // Revalidar mesmo quando a seleção SQL já filtrou pelos limites do escopo atual.
      if(!await store.authorize(scope,id)||!await store.eligible(id)){counts.deferred++;continue;}
      const configuration=await store.settings(scope.scopeId);
      let failure:string|null=null;
      try {await provider.preflight(configuration);}
      catch(error){failure=error instanceof Error?error.message:'O modelo da análise está indisponível.';}
      // Essa RPC grava a tentativa (ou reutiliza uma ativa) E o recibo na mesma transação.
      const queued=await supabase.rpc('enqueue_reciprocity_automatic_event',{
        p_scope_id:scope.scopeId,p_conversation_id:id,p_configuration:configuration,p_error:failure,
      });
      if(queued.error){counts.deferred++;continue;}
      if(queued.data?.state==='failed')counts.failed++;
      else counts.enqueued++;
    }
  }
  return counts;
}
