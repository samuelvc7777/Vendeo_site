import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {getWhatsAppConversationIdentityKey} from '../src/domain/entities/WhatsAppConversationIdentity.ts';
import account from '../src/domain/entities/whatsapp2-account-scope.cjs';
const source=fs.readFileSync('src/presentation/components/chat/InstagramDirect.tsx','utf8');
const start=source.indexOf('    setWhatsApp2Conversations((currentRows) => {');
const end=source.indexOf('    setActiveChat((current) => {',start);
assert.ok(start>0&&end>start);
const reconcile=source.slice(start,end);
const accountId='account-5511999999999';
const phone='5511888888888';
const lid='123456789012345@lid';
const canonical={id:`wa2:${accountId}:${phone}@c.us`,providerId:`${phone}@c.us`,whatsappIdentityKey:`phone:${phone}`,lastMessageAt:'2026-10-07T15:30:00Z',aiAutoRespond:true,isLocked:true,status:'locked'};
const cases=[
 {name:'mensagem local mais recente recoloca o alias antigo',oldKey:`phone:${phone}`,lastMessageAt:'2026-10-07T15:31:00Z'},
 {name:'chave LID em cache ignora telefone recém-resolvido',oldKey:`jid:${lid}`,lastMessageAt:'2026-10-07T15:29:00Z'},
];
for(const fixture of cases){
 let output;
 const currentRows=[{id:`wa2:${accountId}:${lid}`,providerId:lid,whatsappIdentityKey:fixture.oldKey,lastMessageAt:fixture.lastMessageAt,aiAutoRespond:false,isLocked:false,status:'active',lastMessage:'mensagem local'}];
 vm.runInNewContext(reconcile,{
  setWhatsApp2Conversations:fn=>{output=fn(currentRows);},setMessages:()=>{},identityGroups:[],accountId,
  merged:[canonical],mergedByIdentity:new Map([[canonical.whatsappIdentityKey,canonical]]),mergedIdentityKeys:new Set([canonical.whatsappIdentityKey]),
  resolvedPhonesByChatId:new Map([[lid,phone]]),
  getWhatsAppConversationIdentityKey,
  whatsappConversationBelongsToAccount:account.whatsappConversationBelongsToAccount,
  whatsappProviderIdFromConversationId:account.whatsappProviderIdFromConversationId,
  getMessageTimestampMs:date=>Date.parse(date)||0,
 });
 assert.equal(output.length,1,'aliases confirmados devem aparecer uma única vez');
 assert.equal(output[0].id,canonical.id);
 assert.equal(output[0].aiAutoRespond,true);
 assert.equal(output[0].isLocked,true);
 if(fixture.lastMessageAt>canonical.lastMessageAt)assert.equal(output[0].lastMessage,"mensagem local");
 console.log(JSON.stringify({scenario:fixture.name,expectedContacts:1,actualContacts:output.length,canonicalId:output[0].id}));
}
