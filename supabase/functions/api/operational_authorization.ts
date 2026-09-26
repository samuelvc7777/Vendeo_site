/** A API atual não tem usuário/workspace associado à conversa. Somente serviço privilegiado acessa operações do Brain. */
export function isPrivilegedOperationalRequest(request: Request, serviceRoleKey: string | null | undefined): boolean {
  if (!serviceRoleKey) return false;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  const left = new TextEncoder().encode(token);
  const right = new TextEncoder().encode(serviceRoleKey);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}
