import {OpenAiReciprocityProvider, type OpenAiReciprocityOptions} from './reciprocity_openai.ts';
import {SupabaseReciprocityStore} from './reciprocity_repository.ts';
import {ReciprocityService,type ReciprocityScope} from './reciprocity_service.ts';

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
