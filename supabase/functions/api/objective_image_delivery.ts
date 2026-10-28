/** Monta a entrega exclusiva da foto vinculada ao checkpoint atual. */
export function planObjectiveImageDelivery(params: {
  action: string;
  objectiveDecision: string;
  objectiveId: string;
  images: Array<{ id: string; objectiveId?: string; imageUrl: string; caption?: string }>;
}): Array<{ type: "image"; arsenalItemId: string; mediaUrl: string; objectiveId: string; isViewOnce: true; caption?: string }> | null {
  if (params.action === "wait" || params.action === "manual_resolution" || params.objectiveDecision !== "pursue") return null;
  const image = params.images.find((candidate) => candidate.objectiveId === params.objectiveId && candidate.imageUrl.trim());
  if (!image) return [];
  const caption = image.caption?.trim();
  return [{ type: "image", arsenalItemId: image.id, mediaUrl: image.imageUrl, objectiveId: params.objectiveId, isViewOnce: true, ...(caption ? { caption } : {}) }];
}
