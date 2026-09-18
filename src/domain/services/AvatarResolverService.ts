/**
 * Serviço de Domínio para Resolução de Avatares (Clean Architecture)
 * - Se o contato possuir foto oficial do Instagram (URL iniciada com http), utiliza a foto oficial real.
 * - Quando não houver foto (ou o perfil for privado/sem foto), utiliza a foto padrão oficial de 'sem foto' (silhueta neutra estilo Instagram).
 */

export const DEFAULT_NO_PHOTO_AVATAR = "/images/default-avatar.svg";

export function resolveContactAvatar(
  username: string = "",
  fullName?: string,
  existingAvatar?: string | null
): string {
  // Se for uma foto real (URL completa de CDN da Meta/Instagram)
  if (existingAvatar && existingAvatar.trim().startsWith("http")) {
    // Se for URL de teste antigo do unsplash, substitui pelo avatar padrão de sem foto
    if (existingAvatar.includes("images.unsplash.com")) {
      return DEFAULT_NO_PHOTO_AVATAR;
    }
    return existingAvatar.trim();
  }

  return DEFAULT_NO_PHOTO_AVATAR;
}
