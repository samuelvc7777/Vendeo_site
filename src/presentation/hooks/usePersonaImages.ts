import { useEffect, useState, useCallback } from "react";
import { PersonaImageAsset } from "@/domain/entities/ChatStage";
import { SupabasePersonaImageRepository } from "@/infrastructure/repositories/SupabasePersonaImageRepository";

const imageRepository = new SupabasePersonaImageRepository();

export function usePersonaImages() {
  const [images, setImages] = useState<PersonaImageAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadImages = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await imageRepository.getImages();
      setImages(data);
    } catch (error) {
      console.error("Erro ao carregar imagens do cofre:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const addImage = async (data: Omit<PersonaImageAsset, "id" | "createdAt" | "updatedAt">) => {
    const newImage = await imageRepository.saveImage(data);
    setImages((prev) => [...prev, newImage].sort((a, b) => a.title.localeCompare(b.title)));
    return newImage;
  };

  const updateImage = async (id: string, updates: Partial<PersonaImageAsset>) => {
    const updated = await imageRepository.updateImage(id, updates);
    setImages((prev) =>
      prev.map((img) => (img.id === id ? updated : img)).sort((a, b) => a.title.localeCompare(b.title))
    );
    return updated;
  };

  const deleteImage = async (id: string) => {
    await imageRepository.deleteImage(id);
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const toggleImageEnabled = async (id: string, currentEnabled: boolean) => {
    return updateImage(id, { enabled: !currentEnabled });
  };

  return {
    images,
    isLoading,
    addImage,
    updateImage,
    deleteImage,
    toggleImageEnabled,
    refreshImages: loadImages,
  };
}
