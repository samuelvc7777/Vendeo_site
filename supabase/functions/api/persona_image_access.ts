/** Regras do catálogo de fotos: o modelo escolhe; o backend autoriza a entrega. */
export interface AvailablePersonaImage {
  id: string;
  title: string;
  imageUrl: string;
  whatsappImageUrl?: string;
  objectiveId?: string;
  description: string;
  caption: string;
  usageInstruction: string;
  allowedTimeStart?: string;
  allowedTimeEnd?: string;
  isViewOnce: boolean;
  alreadySentInConversation: false;
}

export function isPersonaImageTimeAllowed(start?: string | null, end?: string | null, now = new Date()): boolean {
  if (!start && !end) return true;
  if (!start || !end || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return false;
  try {
    const time = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false}).format(now);
    return start <= end ? time >= start && time <= end : time >= start || time <= end;
  } catch {
    return false;
  }
}

function filename(url?: string | null): string {
  if (!url) return '';
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; }
}

/** Inclui mensagens manuais antigas que ainda não tinham um image_id registrado. */
export function imageMatchesDeliveredMessage(image: any, message: any): boolean {
  const urls = [image.image_url, image.whatsapp_image_url].filter(Boolean);
  const attachment = message.attachment_metadata || {};
  if (urls.some(url => url === message.media_url || url === attachment.mediaUrl || String(message.text || '').includes(`[image:${url}]`))) return true;
  const sentFilename = String(attachment.fileName || attachment.file_name || '');
  return Boolean(sentFilename && urls.some(url => filename(url) === sentFilename));
}

export async function listAvailablePersonaImages(params: {supabase: any; conversationId: string; objectiveId?: string; now?: Date}): Promise<AvailablePersonaImage[]> {
  const {supabase, conversationId, objectiveId, now = new Date()} = params;
  let query = supabase.from('persona_images').select('*').eq('enabled', true);
  if (objectiveId) query = query.eq('objective_id', objectiveId);
  const {data: images, error: imageError} = await query.order('title', {ascending: true});
  if (imageError || !Array.isArray(images)) throw Error('persona_image_catalog_unavailable');
  const sent = new Set<string>();
  const knownProviderMessages = new Set<string>();
  for (const table of ['image_delivery_history', 'persona_image_send_claims']) {
    for (let offset = 0; ; offset += 500) {
      const {data, error} = await supabase.from(table).select('image_id,provider_message_id').eq('conversation_id', conversationId).range(offset, offset + 499);
      if (error || !Array.isArray(data)) throw Error('persona_image_history_unavailable');
      data.forEach((row: any) => {sent.add(String(row.image_id)); if (row.provider_message_id) knownProviderMessages.add(String(row.provider_message_id));});
      if (data.length < 500) break;
    }
  }
  const deliveredMessages: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const {data, error} = await supabase.from('instagram_messages').select('id,text,media_url,attachment_metadata,created_at').eq('conversation_id', conversationId).eq('is_mine', true).eq('media_type', 'image').range(offset, offset + 499);
    if (error || !Array.isArray(data)) throw Error('persona_image_message_history_unavailable');
    deliveredMessages.push(...data);
    if (data.length < 500) break;
  }
  const unidentifiedViewOnceMessages = deliveredMessages.filter(message => message.attachment_metadata?.isViewOnce === true && !knownProviderMessages.has(String(message.id)) && !images.some((image: any) => imageMatchesDeliveredMessage(image, message)));
  const historyCouldIncludeImage = (image: any) => unidentifiedViewOnceMessages.some(message => {
    const imageCreated = Date.parse(String(image.created_at || ''));
    const messageCreated = Date.parse(String(message.created_at || ''));
    return !Number.isFinite(imageCreated) || !Number.isFinite(messageCreated) || messageCreated >= imageCreated;
  });
  return images.filter((image: any) => image.enabled !== false && !sent.has(String(image.id)) && isPersonaImageTimeAllowed(image.allowed_time_start, image.allowed_time_end, now) && !historyCouldIncludeImage(image) && !deliveredMessages.some(message => imageMatchesDeliveredMessage(image, message)))
    .map((image: any) => ({id: String(image.id), title: String(image.title || ''), imageUrl: String(image.image_url || ''), whatsappImageUrl: image.whatsapp_image_url || undefined, objectiveId: image.objective_id || undefined, description: image.description || '', caption: image.caption || '', usageInstruction: image.usage_instruction || '', allowedTimeStart: image.allowed_time_start || undefined, allowedTimeEnd: image.allowed_time_end || undefined, isViewOnce: Boolean(image.is_view_once), alreadySentInConversation: false as const}));
}

/** A ferramenta expõe dados para escolha, nunca a URL nem permissão permanente de envio. */
export function imageToolCandidates(images: AvailablePersonaImage[]) {
  return images.map(image => ({imageId: image.id, objectiveId: image.objectiveId, title: image.title, description: image.description, caption: image.caption, whenToUse: image.usageInstruction, allowedTimeStart: image.allowedTimeStart, allowedTimeEnd: image.allowedTimeEnd}));
}

export async function claimPersonaImageSend(supabase: any, conversationId: string, imageId: string, deliveryKey: string) {
  const {data, error} = await supabase.rpc('claim_persona_image_send', {p_conversation_id: conversationId, p_image_id: imageId, p_delivery_key: deliveryKey});
  if (error || !data) throw Error('persona_image_claim_unavailable');
  return data as {allowed: boolean; reason?: string; alreadySent?: boolean; providerMessageId?: string};
}

export async function settlePersonaImageSend(supabase: any, conversationId: string, imageId: string, deliveryKey: string, outcome: {success: boolean; isUncertain?: boolean; providerMessageId?: string}) {
  const table = supabase.from('persona_image_send_claims');
  const query = outcome.success || outcome.isUncertain
    ? table.update({state: outcome.success ? 'sent' : 'uncertain', provider_message_id: outcome.providerMessageId || null, updated_at: new Date().toISOString()})
    : table.delete().eq('state', 'reserved');
  const {error} = await query.eq('conversation_id', conversationId).eq('image_id', imageId).eq('delivery_key', deliveryKey);
  if (error) throw Error('persona_image_claim_settle_failed');
}

export type PersonaImageToolCandidate = ReturnType<typeof imageToolCandidates>[number];
