import type {ReciprocityConfiguration, ReciprocityReason} from '../../../src/domain/entities/Reciprocity.ts';
import {ReciprocityError, type ReciprocityScope, type ReciprocityStore, type StoredReciprocityAttempt} from './reciprocity_service.ts';

// O cliente recebido aqui é somente server-side/service_role. Não exportar ao navegador.
export class SupabaseReciprocityStore implements ReciprocityStore {
  supabase:any;
  constructor(supabase:any){this.supabase=supabase;}
  async authorize(scope:ReciprocityScope,id:string){
    const {data,error}=await this.supabase.from('instagram_conversations').select('id').eq('id',id).maybeSingle();
    if(error) throw new ReciprocityError('Não foi possível verificar a conversa.',503);
    if(!data)return false;
    if(scope.allConversations===true || scope.conversationIds?.includes(id))return true;
    if(!scope.accountIds?.length)return false;
    const identities=await this.supabase.from('conversation_channel_identities').select('channel,external_account_id,status').eq('conversation_id',id);
    if(identities.error) throw new ReciprocityError('Não foi possível verificar o escopo da conversa.',503);
    return (identities.data||[]).some((i:{channel:string;external_account_id?:string;status:string})=>
      ['active','transferred'].includes(i.status)&&i.external_account_id&&scope.accountIds?.includes(`${i.channel}:${i.external_account_id}`));
  }
  async eligible(id:string){
    const {data,error}=await this.supabase.rpc('reciprocity_checklist_complete',{p_conversation_id:id});
    if(error)throw new ReciprocityError('Não foi possível verificar o checklist.',503);
    return data===true;
  }
  async settings(scopeId:string):Promise<ReciprocityConfiguration>{
    const {data,error}=await this.supabase.from('reciprocity_settings').select('model,reasoning').eq('scope_id',scopeId).maybeSingle();
    if(error)throw new ReciprocityError('Não foi possível consultar a configuração da análise.',503);
    return data||{model:'gpt-6-luna',reasoning:'low'};
  }
  async saveSettings(scopeId:string,configuration:ReciprocityConfiguration){
    const {error}=await this.supabase.from('reciprocity_settings').upsert({scope_id:scopeId,...configuration,updated_at:new Date().toISOString()},{onConflict:'scope_id'});
    if(error)throw new ReciprocityError('Não foi possível salvar a configuração da análise.',503);
    return configuration;
  }
  async list(scopeId:string,id:string){
    const results:StoredReciprocityAttempt[]=[];
    for(let from=0;;from+=100){
      const {data,error}=await this.supabase.from('reciprocity_attempts').select('*').eq('scope_id',scopeId).eq('conversation_id',id)
        .order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,from+99);
      if(error)throw new ReciprocityError('Não foi possível consultar as avaliações.',503);
      for(const row of data||[])results.push(storedAttemptFromRow(row));
      if((data||[]).length<100)break;
    }
    return results;
  }
  async enqueue(scopeId:string,id:string,reason:ReciprocityReason,configuration:ReciprocityConfiguration){
    const {data,error}=await this.supabase.rpc('enqueue_reciprocity_analysis',{p_scope_id:scopeId,p_conversation_id:id,p_reason:reason,p_configuration:configuration});
    if(error||!data){
      if(error?.message?.includes('no_messages_available'))throw new ReciprocityError('Não há mensagens disponíveis para a análise.',409);
      if(error?.message?.includes('checklist_incomplete'))throw new ReciprocityError('O checklist ainda não está completo.',409);
      throw new ReciprocityError('Não foi possível agendar a análise.',503);
    }
    return data as StoredReciprocityAttempt;
  }
  async claim(){
    const {data,error}=await this.supabase.rpc('claim_reciprocity_analysis',{p_lease_token:crypto.randomUUID()});
    if(error)throw new ReciprocityError('Não foi possível reservar uma análise.',503);
    return data as StoredReciprocityAttempt|null;
  }
  async finish(id:string,state:'completed'|'failed',values:Partial<StoredReciprocityAttempt>,leaseToken?:string){
    const {data,error}=await this.supabase.rpc('finish_reciprocity_analysis',{p_id:id,p_lease_token:leaseToken,p_state:state,p_values:values});
    if(error)throw new ReciprocityError('Não foi possível persistir o resultado da análise.',503);
    return data===true;
  }
}
export function storedAttemptFromRow(row:any):StoredReciprocityAttempt {
  return {id:row.id,scopeId:row.scope_id,conversationId:row.conversation_id,reason:row.reason,state:row.state,
    configuration:row.configuration,criteriaVersion:row.criteria_version,createdAt:row.created_at,
    ...(row.completed_at?{completedAt:row.completed_at}:{}),messages:row.messages,
    ...(row.result?{result:row.result}:{}),...(row.usage?{usage:row.usage}:{}),
    estimatedCostUsd:row.estimated_cost_usd===null?null:Number(row.estimated_cost_usd),
    ...(row.duration_ms!==null?{durationMs:row.duration_ms}:{}),...(row.error?{error:row.error}:{}),
    ...(row.lease_token?{leaseToken:row.lease_token}:{}),
  };
}
