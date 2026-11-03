import {ReciprocityError, type ReciprocityScope} from './reciprocity_service.ts';

export type ConfiguredReciprocityScope = ReciprocityScope & {tokenHash:string};
export function parseReciprocityScopes(scopesJson: string): ConfiguredReciprocityScope[] {
  let values: unknown;
  try {values=JSON.parse(scopesJson || '[]');} catch {throw new ReciprocityError('Configuração de acesso à análise inválida.',503);}
  if (!Array.isArray(values)) throw new ReciprocityError('Configuração de acesso à análise inválida.',503);
  const valid=values.filter((v):v is ConfiguredReciprocityScope => Boolean(v && typeof v.scopeId==='string' && v.scopeId.trim()
    && typeof v.tokenHash==='string' && /^[a-f0-9]{64}$/.test(v.tokenHash)
    && (v.allConversations===true || (Array.isArray(v.conversationIds)&&v.conversationIds.every((x:unknown)=>typeof x==='string'))
      || (Array.isArray(v.accountIds)&&v.accountIds.every((x:unknown)=>typeof x==='string')))));
  if(valid.length!==values.length) throw new ReciprocityError('Configuração de acesso à análise inválida.',503);
  // Hashes ou escopos duplicados tornam ambígua a autorização de eventos automáticos.
  if(new Set(valid.map(v=>v.tokenHash)).size!==valid.length || new Set(valid.map(v=>v.scopeId)).size!==valid.length)
    throw new ReciprocityError('Escopos de análise duplicados.',503);
  return valid;
}
function sameHash(a:string,b:string) {let difference=a.length^b.length; for(let i=0;i<64;i++) difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0); return difference===0;}
export async function authenticateReciprocityScope(request:Request, scopesJson:string):Promise<ReciprocityScope>{
  const token=request.headers.get('x-reciprocity-key') || '';
  if(!token || token.length>4096) throw new ReciprocityError('Informe uma chave de acesso válida para a análise.',401);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hash=Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('');
  const configured=parseReciprocityScopes(scopesJson).find(v=>sameHash(v.tokenHash,hash));
  if(!configured) throw new ReciprocityError('Chave de acesso à análise inválida ou revogada.',401);
  const {tokenHash:_hash,...scope}=configured;
  return scope;
}
