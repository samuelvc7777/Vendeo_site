"use client";

import { useState, useEffect, useCallback } from "react";
import {
  VaultFolderWithStats,
  VaultFolder,
  VaultItem,
} from "@/domain/entities/Vault";
import { manageVaultUseCase } from "@/infrastructure/di/container";
import { convertAndAnalyzeAudio } from "@/presentation/components/chat/audio-converter";
import { getApiUrl } from "@/infrastructure/http/network";
import { apiFetch as fetch } from "@/infrastructure/http/apiFetch";

export function useVault() {
  const [folders, setFolders] = useState<VaultFolderWithStats[]>([]);
  const [activeFolder, setActiveFolder] = useState<VaultFolder | null>(null);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<VaultItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Carregar lista de pastas com estatísticas
  const refreshFolders = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await manageVaultUseCase.listFoldersWithStats();
      setFolders(data);
    } catch (err) {
      console.error("Erro ao carregar pastas do cofre:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Carregar itens da pasta ativa
  const refreshItems = useCallback(async (folderId: string) => {
    try {
      setIsLoading(true);
      const data = await manageVaultUseCase.listItems(folderId);
      setItems(data);
    } catch (err) {
      console.error("Erro ao carregar itens da pasta:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  useEffect(() => {
    if (activeFolder) {
      refreshItems(activeFolder.id);
    } else {
      setItems([]);
    }
  }, [activeFolder, refreshItems]);

  // Busca global no cofre
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const results = await manageVaultUseCase.search(searchQuery);
        setSearchResults(results);
      } catch (err) {
        console.error("Erro na busca do cofre:", err);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Ações de pastas
  const createFolder = async (name: string, color?: string) => {
    const folder = await manageVaultUseCase.createFolder(name, color);
    await refreshFolders();
    return folder;
  };

  const renameFolder = async (id: string, name: string) => {
    const folder = await manageVaultUseCase.renameFolder(id, name);
    if (activeFolder?.id === id) {
      setActiveFolder(folder);
    }
    await refreshFolders();
    return folder;
  };

  const deleteFolder = async (id: string) => {
    await manageVaultUseCase.deleteFolder(id);
    if (activeFolder?.id === id) {
      setActiveFolder(null);
    }
    await refreshFolders();
  };

  // Ações de itens
  const addTextItem = async (folderId: string, title: string, content: string, linkedItemId?: string) => {
    const item = await manageVaultUseCase.createItem({
      folderId,
      type: "text",
      title,
      content,
      linkedItemId,
    });
    if (activeFolder?.id === folderId) {
      await refreshItems(folderId);
    }
    await refreshFolders();
    return item;
  };

  const addAudioItem = async (
    folderId: string,
    title: string,
    file: File,
    linkedItemId?: string
  ): Promise<VaultItem> => {
    // 1. Converte qualquer áudio recebido (.mp4, .mp3, .ogg, .webm, .wav) para formato padrão aceito pela Meta e afere duração exata
    const { file: convertedFile, duration } = await convertAndAnalyzeAudio(file);

    // 2. Faz upload para o Supabase Storage para gerar a URL pública definitiva
    let remoteMediaUrl: string | undefined;
    try {
      const formData = new FormData();
      formData.append("file", convertedFile);
      formData.append("type", "audio");

      const res = await fetch(getApiUrl("/api/instagram/upload"), {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.url) {
          remoteMediaUrl = data.url;
        }
      }
    } catch (uploadErr) {
      console.warn("Aviso ao enviar áudio para o servidor (salvando offline no IndexedDB):", uploadErr);
    }

    const item = await manageVaultUseCase.createItem({
      folderId,
      type: "audio",
      title,
      mediaBlob: convertedFile,
      mediaUrl: remoteMediaUrl,
      duration,
      fileName: convertedFile.name,
      mimeType: convertedFile.type || "audio/wav",
      fileSize: convertedFile.size,
      linkedItemId,
    });

    if (activeFolder?.id === folderId) {
      await refreshItems(folderId);
    }
    await refreshFolders();
    return item;
  };

  const addImageItem = async (
    folderId: string,
    title: string,
    file: File,
    linkedItemId?: string
  ): Promise<VaultItem> => {
    let remoteMediaUrl: string | undefined;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "image");

      const res = await fetch(getApiUrl("/api/instagram/upload"), {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.url) {
          remoteMediaUrl = data.url;
        }
      }
    } catch (uploadErr) {
      console.warn("Aviso ao enviar foto para o servidor (salvando offline no IndexedDB):", uploadErr);
    }

    const item = await manageVaultUseCase.createItem({
      folderId,
      type: "image",
      title,
      mediaBlob: file,
      mediaUrl: remoteMediaUrl,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      linkedItemId,
    });

    if (activeFolder?.id === folderId) {
      await refreshItems(folderId);
    }
    await refreshFolders();
    return item;
  };

  const deleteItem = async (id: string) => {
    await manageVaultUseCase.deleteItem(id);
    if (activeFolder) {
      await refreshItems(activeFolder.id);
    }
    await refreshFolders();
  };

  const updateItem = async (id: string, updates: Partial<VaultItem>) => {
    const updated = await manageVaultUseCase.updateItem(id, updates);
    if (activeFolder) {
      await refreshItems(activeFolder.id);
    }
    return updated;
  };

  const reorderItems = async (orderedItems: VaultItem[]) => {
    setItems(orderedItems);
    if (activeFolder) {
      await manageVaultUseCase.reorderItems(activeFolder.id, orderedItems);
    }
  };

  return {
    folders,
    activeFolder,
    items,
    isLoading,
    searchQuery,
    searchResults,
    isSearching,
    setActiveFolder,
    setSearchQuery,
    createFolder,
    renameFolder,
    deleteFolder,
    addTextItem,
    addAudioItem,
    addImageItem,
    updateItem,
    reorderItems,
    deleteItem,
    refreshFolders,
  };
}
