import { useState, useCallback } from 'react';

interface ContextMenuState {
  symbol: string;
  name?: string;
  x: number;
  y: number;
}

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const openContextMenu = useCallback((e: React.MouseEvent, symbol: string, name?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ symbol, name, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return { contextMenu, openContextMenu, closeContextMenu };
}
