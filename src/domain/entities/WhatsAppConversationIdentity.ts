export interface WhatsAppGatewayIdentityRow {
  id: string;
  providerId?: string | null;
}

export interface WhatsAppCanonicalIdentityRow {
  id: string;
  contact_id?: string | null;
}

export interface WhatsAppConversationIdentityGroup<GatewayRow, CanonicalRow> {
  identityKey: string;
  gatewayRows: GatewayRow[];
  canonicalRows: CanonicalRow[];
}

function cleanWhatsAppIdentity(value: unknown): string {
  return String(value ?? "").trim().replace(/^wa2:(?:account-[^:]+:)?/i, "");
}

function resolvePhoneForIdentity(
  identity: string,
  resolvedPhones: ReadonlyMap<string, string | null | undefined>,
): string | null {
  const candidates = [identity, identity.toLowerCase(), `wa2:${identity}`, `wa2:${identity.toLowerCase()}`];
  for (const candidate of candidates) {
    const phone = resolvedPhones.get(candidate);
    if (typeof phone === "string" && phone.trim()) return phone.trim();
  }
  return null;
}

/** Builds a grouping key only from a phone JID or a phone the gateway resolved for a LID. */
export function getWhatsAppConversationIdentityKey(
  identityId: unknown,
  resolvedPhone?: unknown,
): string {
  const identity = cleanWhatsAppIdentity(identityId);
  if (!identity) return "jid:";

  const isLid = identity.toLowerCase().endsWith("@lid");
  const domain = identity.match(/@([^@]+)$/)?.[1]?.toLowerCase() || "";
  if (domain && !["lid", "c.us", "s.whatsapp.net", "whatsapp.net"].includes(domain)) {
    return `jid:${identity.toLowerCase()}`;
  }
  const phoneCandidate = isLid ? String(resolvedPhone ?? "").trim() : identity;
  const digits = phoneCandidate
    .replace(/^wa2:(?:account-[^:]+:)?/i, "")
    .replace(/@[^@]*$/, "")
    .replace(/\D+/g, "");

  if (digits.length >= 8 && digits.length <= 15) return `phone:${digits}`;
  return `jid:${identity.toLowerCase()}`;
}

/** Groups provider aliases only when their phone identity is known, leaving unresolved LIDs separate. */
export function groupWhatsAppConversationRows<
  GatewayRow extends WhatsAppGatewayIdentityRow,
  CanonicalRow extends WhatsAppCanonicalIdentityRow,
>(
  gatewayRows: readonly GatewayRow[],
  canonicalRows: readonly CanonicalRow[],
  resolvedPhones: ReadonlyMap<string, string | null | undefined> = new Map(),
): Array<WhatsAppConversationIdentityGroup<GatewayRow, CanonicalRow>> {
  const groups = new Map<string, WhatsAppConversationIdentityGroup<GatewayRow, CanonicalRow>>();
  const getGroup = (identityKey: string) => {
    let group = groups.get(identityKey);
    if (!group) {
      group = { identityKey, gatewayRows: [], canonicalRows: [] };
      groups.set(identityKey, group);
    }
    return group;
  };

  for (const row of gatewayRows) {
    const providerId = cleanWhatsAppIdentity(row.providerId || row.id);
    const resolvedPhone = resolvePhoneForIdentity(providerId, resolvedPhones);
    getGroup(getWhatsAppConversationIdentityKey(providerId, resolvedPhone)).gatewayRows.push(row);
  }

  for (const row of canonicalRows) {
    const contactId = cleanWhatsAppIdentity(row.contact_id || row.id);
    const resolvedPhone = resolvePhoneForIdentity(contactId, resolvedPhones);
    getGroup(getWhatsAppConversationIdentityKey(contactId, resolvedPhone)).canonicalRows.push(row);
  }

  return Array.from(groups.values());
}

export function reconcileWhatsAppControlState(
  gatewayStates: readonly { archived?: boolean; isLocked?: boolean; status?: string | null }[],
  canonicalStatuses: readonly (string | null | undefined)[],
  fallbackStatus?: string | null,
): { archived: boolean; isLocked: boolean; status: string } {
  const isLocked = gatewayStates.some((state) =>
    state.isLocked === true || state.status === "locked" || state.status === "vault"
  ) || canonicalStatuses.some((status) => status === "locked" || status === "vault");
  const isArchived = !isLocked && (
    gatewayStates.some((state) => state.archived === true || state.status === "archived") ||
    canonicalStatuses.some((status) => status === "archived")
  );

  const fallback = String(fallbackStatus || "active");
  const status = isLocked
    ? "locked"
    : isArchived
    ? "archived"
    : fallback === "archived" || fallback === "locked" || fallback === "vault"
    ? "active"
    : fallback;

  return { archived: isArchived, isLocked, status };
}
