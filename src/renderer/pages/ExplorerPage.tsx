// ============================================================================
// Nexora — Windows 11 File Explorer Page
// Command bar, segmented address bar, multi-selection, details/grid/list views,
// context menu, right-hand preview/details drawer, and Nexora intelligence.
// ============================================================================

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useExplorerStore, toast } from '../store';
import { api } from '../services/api';
import type { DirectoryEntry } from '../../shared/types';

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getFileIcon(entry: { isDirectory: boolean; extension: string }): string {
  if (entry.isDirectory) return '📁';
  const ext = entry.extension.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.heic', '.raw'].includes(ext)) return '🖼';
  if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.webm'].includes(ext)) return '🎬';
  if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) return '🎵';
  if (['.pdf'].includes(ext)) return '📕';
  if (['.doc', '.docx', '.txt', '.md', '.rtf'].includes(ext)) return '📄';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return '📊';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return '📦';
  if (['.exe', '.msi'].includes(ext)) return '⚙';
  if (['.js', '.ts', '.py', '.html', '.css', '.json', '.sql'].includes(ext)) return '💻';
  return '📄';
}

export const ExplorerPage: React.FC = () => {
  const {
    currentPath,
    entries,
    drives,
    selectedFiles,
    focusedIndex,
    viewMode,
    sortBy,
    sortOrder,
    loading,
    error,
    history,
    historyIndex,
    searchFilter,
    detailsPaneOpen,
    activeFileDetails,
    clipboard,
    navigateTo,
    refresh,
    loadDrives,
    toggleSelection,
    selectAll,
    clearSelection,
    setSearchFilter,
    setViewMode,
    setSortBy,
    toggleDetailsPane,
    loadFileDetails,
    goBack,
    goForward,
    goUp,
    copySelection,
    cutSelection,
    pasteClipboard,
  } = useExplorerStore();

  // Address bar manual editing mode
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [manualPathInput, setManualPathInput] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  // Command bar menus
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    entry: DirectoryEntry | null;
  }>({ visible: false, x: 0, y: 0, entry: null });

  // Dialog states
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('New folder');

  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DirectoryEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [deleteConfirmModalOpen, setDeleteConfirmModalOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // In-place AI Feature states
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationResult, setClassificationResult] = useState<{
    filePath: string;
    top_classes: Array<{ label: string; confidence: number }>;
    tags: string[];
  } | null>(null);

  const [isExtractingOcr, setIsExtractingOcr] = useState(false);
  const [ocrResult, setOcrResult] = useState<{
    filePath: string;
    text: string;
    confidence: number;
    status?: string;
  } | null>(null);

  useEffect(() => {
    loadDrives();
  }, [loadDrives]);

  // Sync manual path input with currentPath
  useEffect(() => {
    setManualPathInput(currentPath);
  }, [currentPath]);

  // Filter entries based on searchFilter
  const filteredEntries = searchFilter.trim()
    ? entries.filter((e) => e.name.toLowerCase().includes(searchFilter.toLowerCase()))
    : entries;

  // Calculate total selected size
  const selectedEntries = entries.filter((e) => selectedFiles.has(e.path));
  const totalSelectedSize = selectedEntries.reduce((acc, curr) => acc + (curr.isFile ? curr.size : 0), 0);

  // Handle entry clicking
  const handleEntryClick = (e: React.MouseEvent, entry: DirectoryEntry) => {
    toggleSelection(entry.path, e.ctrlKey || e.metaKey, e.shiftKey);
  };

  const handleEntryDoubleClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path);
    } else {
      api().fs.openFile(entry.path);
    }
  };

  // Context menu trigger
  const handleContextMenu = (e: React.MouseEvent, entry?: DirectoryEntry) => {
    e.preventDefault();
    e.stopPropagation();
    if (entry) {
      if (!selectedFiles.has(entry.path)) {
        toggleSelection(entry.path, false, false);
      }
      setContextMenu({
        visible: true,
        x: Math.min(e.clientX, window.innerWidth - 220),
        y: Math.min(e.clientY, window.innerHeight - 280),
        entry,
      });
    } else {
      // Background context menu
      setContextMenu({
        visible: true,
        x: Math.min(e.clientX, window.innerWidth - 220),
        y: Math.min(e.clientY, window.innerHeight - 200),
        entry: null,
      });
    }
  };

  // Close menus on window click
  useEffect(() => {
    const handleOutsideClick = () => {
      if (contextMenu.visible) setContextMenu((s) => ({ ...s, visible: false }));
      if (sortMenuOpen) setSortMenuOpen(false);
      if (viewMenuOpen) setViewMenuOpen(false);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [contextMenu.visible, sortMenuOpen, viewMenuOpen]);

  // Standard Windows Explorer Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      // Ctrl+A: Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }

      // Ctrl+C: Copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelection();
        return;
      }

      // Ctrl+X: Cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        cutSelection();
        return;
      }

      // Ctrl+V: Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }

      // F5: Refresh
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
        e.preventDefault();
        refresh();
        return;
      }

      // F2: Rename selected
      if (e.key === 'F2') {
        e.preventDefault();
        if (selectedFiles.size === 1) {
          const target = entries.find((en) => selectedFiles.has(en.path));
          if (target) {
            setRenameTarget(target);
            setRenameValue(target.name);
            setRenameModalOpen(true);
          }
        }
        return;
      }

      // Delete: Trash selected
      if (e.key === 'Delete') {
        e.preventDefault();
        if (selectedFiles.size > 0) {
          setDeleteTargets(Array.from(selectedFiles));
          setDeleteConfirmModalOpen(true);
        }
        return;
      }

      // Enter: Open focused or single selected
      if (e.key === 'Enter') {
        if (selectedFiles.size === 1) {
          const target = entries.find((en) => selectedFiles.has(en.path));
          if (target) {
            if (target.isDirectory) navigateTo(target.path);
            else api().fs.openFile(target.path);
          }
        }
        return;
      }

      // Backspace or Alt+Up: Go Up
      if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
        e.preventDefault();
        goUp();
        return;
      }

      // Alt+Left: Back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
        return;
      }

      // Alt+Right: Forward
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
        return;
      }

      // Arrow navigation
      if (['ArrowDown', 'ArrowUp'].includes(e.key) && entries.length > 0) {
        e.preventDefault();
        let nextIdx = focusedIndex;
        if (e.key === 'ArrowDown') {
          nextIdx = focusedIndex < entries.length - 1 ? focusedIndex + 1 : 0;
        } else if (e.key === 'ArrowUp') {
          nextIdx = focusedIndex > 0 ? focusedIndex - 1 : entries.length - 1;
        }
        const target = entries[nextIdx];
        if (target) {
          toggleSelection(target.path, false, false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    entries,
    selectedFiles,
    focusedIndex,
    selectAll,
    copySelection,
    cutSelection,
    pasteClipboard,
    refresh,
    goUp,
    goBack,
    goForward,
    navigateTo,
    toggleSelection,
  ]);

  // Path submission from manual edit mode
  const handleManualPathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditingPath(false);
    if (manualPathInput.trim()) {
      navigateTo(manualPathInput.trim());
    } else {
      navigateTo('');
    }
  };

  // Create folder handler
  const handleCreateFolder = async () => {
    if (!currentPath) {
      toast.warning('Cannot create folder at root This PC level');
      return;
    }
    try {
      const res = await api().fs.createFolder(currentPath, newFolderName);
      if (res.success) {
        toast.success(`Folder "${newFolderName}" created`);
        setNewFolderModalOpen(false);
        setNewFolderName('New folder');
        await refresh();
      } else {
        toast.error(res.error || 'Failed to create folder');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // Rename handler
  const handleExecuteRename = async () => {
    if (!renameTarget) return;
    try {
      const res = await api().fs.renameEntry(renameTarget.path, renameValue);
      if (res.success) {
        toast.success(`Renamed to "${renameValue}"`);
        setRenameModalOpen(false);
        setRenameTarget(null);
        await refresh();
      } else {
        toast.error(res.error || 'Failed to rename');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // Delete / Trash handler (moves to Windows Recycle Bin safely)
  const handleExecuteDelete = async () => {
    if (deleteTargets.length === 0) return;
    setIsDeleting(true);
    let successCount = 0;
    const errors: string[] = [];

    for (const targetPath of deleteTargets) {
      try {
        const res = await api().fs.trashItem(targetPath);
        if (res.success) {
          successCount++;
        } else {
          errors.push(res.error || `Failed to recycle ${targetPath}`);
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    setIsDeleting(false);
    setDeleteConfirmModalOpen(false);
    setDeleteTargets([]);

    if (successCount > 0) {
      toast.success(
        `Moved ${successCount} item${successCount > 1 ? 's' : ''} to Windows Recycle Bin`,
        'Safe Deletion'
      );
      clearSelection();
      await refresh();
    }
    if (errors.length > 0) {
      toast.error(errors.join(', '));
    }
  };

  // Run local AI Image Classification
  const handleRunClassification = async (targetFilePath?: string) => {
    const filePath = targetFilePath || activeFileDetails?.path;
    if (!filePath) return;

    setIsClassifying(true);
    try {
      toast.info('Running MobileNetV2 neural vision classifier...', 'Local AI Inference');
      const res = await api().ai.classifyImage(filePath);
      if (res && res.top_classes && res.top_classes.length > 0) {
        setClassificationResult({
          filePath,
          top_classes: res.top_classes,
          tags: res.tags || [],
        });
        toast.success(
          `Detected: ${res.top_classes[0].label} (${Math.round(res.top_classes[0].confidence * 100)}%)`,
          'AI Vision Complete'
        );
      } else {
        setClassificationResult({
          filePath,
          top_classes: [],
          tags: [],
        });
        toast.info('No high-confidence visual objects recognized in this image.', 'Inference Complete');
      }
    } catch (err) {
      console.error('Classification error:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'AI Classification Failed');
    } finally {
      setIsClassifying(false);
    }
  };

  // Run local AI OCR text extraction
  const handleRunOcr = async (targetFilePath?: string) => {
    const filePath = targetFilePath || activeFileDetails?.path;
    if (!filePath) return;

    setIsExtractingOcr(true);
    try {
      toast.info('Running PP-OCRv3 neural text detection & CRNN recognizer...', 'Local AI OCR');
      const res = await api().ai.extractOcr(filePath);
      if (res && res.text && res.text.trim()) {
        setOcrResult({
          filePath,
          text: res.text.trim(),
          confidence: res.confidence,
          status: res.status,
        });
        toast.success(`Extracted ${res.text.trim().split(/\s+/).length} words of text.`, 'OCR Complete');
      } else {
        setOcrResult({
          filePath,
          text: '',
          confidence: 0,
          status: res?.status || 'no_text_found',
        });
        toast.info('No readable text detected in this file.', 'OCR Result');
      }
    } catch (err) {
      console.error('OCR error:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'AI OCR Failed');
    } finally {
      setIsExtractingOcr(false);
    }
  };

  // Build segmented breadcrumbs
  const breadcrumbSegments = currentPath
    ? currentPath.split(/[\\/]/).filter(Boolean).reduce<{ label: string; path: string }[]>((acc, part, i) => {
        const isDrive = i === 0 && /^[a-zA-Z]:$/.test(part);
        const segmentPath = isDrive ? `${part}\\` : i > 0 ? `${acc[i - 1].path}${part}\\` : `${part}\\`;
        acc.push({ label: part, path: segmentPath });
        return acc;
      }, [])
    : [];

  return (
    <div
      className="page-content win11-explorer"
      style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%', userSelect: 'none' }}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* ─── 1. Navigation & Address Bar ───────────────────────────────────── */}
      <div
        className="win11-address-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '6px var(--space-4)',
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        {/* Navigation Buttons: Back, Forward, Up, Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={goBack}
            disabled={historyIndex <= 0}
            title="Back (Alt+Left)"
            style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ←
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
            title="Forward (Alt+Right)"
            style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            →
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={goUp}
            disabled={!currentPath}
            title="Up to parent folder (Alt+Up)"
            style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ↑
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={refresh}
            title="Refresh (F5)"
            style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ↻
          </button>
        </div>

        {/* Address Bar / Breadcrumbs */}
        <div
          className="win11-address-box"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            height: '30px',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 8px',
            minWidth: 0,
            fontSize: 'var(--font-size-xs)',
          }}
        >
          {isEditingPath ? (
            <form onSubmit={handleManualPathSubmit} style={{ width: '100%', display: 'flex' }}>
              <input
                ref={pathInputRef}
                type="text"
                value={manualPathInput}
                onChange={(e) => setManualPathInput(e.target.value)}
                onBlur={() => setIsEditingPath(false)}
                autoFocus
                style={{
                  width: '100%',
                  height: '24px',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--font-size-xs)',
                  fontFamily: 'var(--font-mono)',
                  padding: 0,
                }}
              />
            </form>
          ) : (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0, overflowX: 'auto', cursor: 'text' }}
              onClick={() => {
                setIsEditingPath(true);
                setTimeout(() => pathInputRef.current?.select(), 20);
              }}
            >
              {/* Root "This PC" */}
              <button
                className="breadcrumb-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  clearSelection();
                  navigateTo('');
                }}
                title="This PC"
                style={{
                  background: 'none',
                  border: 'none',
                  color: !currentPath ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 4px',
                  borderRadius: '3px',
                  fontSize: 'var(--font-size-xs)',
                }}
              >
                <span>🖥</span>
                <span>This PC</span>
              </button>

              {breadcrumbSegments.map((segment, idx) => (
                <React.Fragment key={segment.path}>
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: '11px' }}>›</span>
                  <button
                    className="breadcrumb-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSelection();
                      navigateTo(segment.path);
                    }}
                    title={segment.path}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: idx === breadcrumbSegments.length - 1 ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      fontWeight: idx === breadcrumbSegments.length - 1 ? 600 : 400,
                      padding: '2px 4px',
                      borderRadius: '3px',
                      fontSize: 'var(--font-size-xs)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {segment.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Quick Copy Path Button */}
          {currentPath && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(currentPath);
                toast.info('Path copied to clipboard');
              }}
              title="Copy current address"
              style={{ padding: '2px 4px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}
            >
              📋
            </button>
          )}
        </div>

        {/* Contextual Filter / Search in Current Folder */}
        <div style={{ position: 'relative', width: '220px', flexShrink: 0 }}>
          <input
            type="text"
            placeholder={currentPath ? `Filter ${currentPath.split(/[\\/]/).pop()}...` : 'Filter drives...'}
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={{
              width: '100%',
              height: '30px',
              paddingLeft: '24px',
              paddingRight: searchFilter ? '24px' : '8px',
              fontSize: 'var(--font-size-xs)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
            }}
          />
          <span style={{ position: 'absolute', left: '7px', top: '7px', fontSize: '11px', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>
            🔍
          </span>
          {searchFilter && (
            <button
              onClick={() => setSearchFilter('')}
              style={{
                position: 'absolute',
                right: '6px',
                top: '6px',
                fontSize: '11px',
                color: 'var(--color-text-tertiary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ─── 2. Windows 11 Command Bar ─────────────────────────────────────── */}
      <div
        className="win11-command-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px var(--space-4)',
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
          gap: 'var(--space-2)',
        }}
      >
        {/* Left Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          {/* New Button */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (!currentPath) {
                toast.warning('Navigate into a drive or folder to create a new folder');
                return;
              }
              setNewFolderModalOpen(true);
            }}
            disabled={!currentPath}
            title="Create new folder in current directory"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: 'var(--color-text-primary)' }}
          >
            <span>➕</span>
            <span>New folder</span>
          </button>

          <div style={{ width: '1px', height: '16px', background: 'var(--color-border)', margin: '0 4px' }} />

          {/* Cut */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={cutSelection}
            disabled={selectedFiles.size === 0}
            title="Cut (Ctrl+X)"
            style={{ opacity: selectedFiles.size === 0 ? 0.4 : 1 }}
          >
            ✂ Cut
          </button>

          {/* Copy */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={copySelection}
            disabled={selectedFiles.size === 0}
            title="Copy (Ctrl+C)"
            style={{ opacity: selectedFiles.size === 0 ? 0.4 : 1 }}
          >
            📄 Copy
          </button>

          {/* Paste */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => pasteClipboard()}
            disabled={!clipboard || clipboard.items.length === 0 || !currentPath}
            title="Paste into current folder (Ctrl+V)"
            style={{
              opacity: !clipboard || clipboard.items.length === 0 || !currentPath ? 0.4 : 1,
              color: clipboard && clipboard.items.length > 0 ? 'var(--color-accent)' : undefined,
            }}
          >
            📋 Paste {clipboard && `(${clipboard.items.length})`}
          </button>

          {/* Rename */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (selectedFiles.size === 1) {
                const target = entries.find((en) => selectedFiles.has(en.path));
                if (target) {
                  setRenameTarget(target);
                  setRenameValue(target.name);
                  setRenameModalOpen(true);
                }
              }
            }}
            disabled={selectedFiles.size !== 1}
            title="Rename selected item (F2)"
            style={{ opacity: selectedFiles.size !== 1 ? 0.4 : 1 }}
          >
            ✏ Rename
          </button>

          {/* Share / Copy Path */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (selectedFiles.size > 0) {
                const paths = Array.from(selectedFiles).join('\n');
                navigator.clipboard.writeText(paths);
                toast.info(`Copied ${selectedFiles.size} path${selectedFiles.size > 1 ? 's' : ''} to clipboard`);
              }
            }}
            disabled={selectedFiles.size === 0}
            title="Copy full path of selected items"
            style={{ opacity: selectedFiles.size === 0 ? 0.4 : 1 }}
          >
            🔗 Copy path
          </button>

          {/* Delete */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (selectedFiles.size > 0) {
                setDeleteTargets(Array.from(selectedFiles));
                setDeleteConfirmModalOpen(true);
              }
            }}
            disabled={selectedFiles.size === 0}
            title="Move selected items to Recycle Bin (Delete)"
            style={{
              opacity: selectedFiles.size === 0 ? 0.4 : 1,
              color: selectedFiles.size > 0 ? 'var(--color-error)' : undefined,
            }}
          >
            🗑 Delete
          </button>
        </div>

        {/* Right Tools: Sort, View Switcher, Details Pane Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Sort Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                setSortMenuOpen(!sortMenuOpen);
                setViewMenuOpen(false);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>⇅</span>
              <span>Sort</span>
              <span style={{ fontSize: '10px' }}>▾</span>
            </button>

            {sortMenuOpen && (
              <div
                className="win11-menu"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: '4px',
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  width: '160px',
                  zIndex: 100,
                  padding: '4px 0',
                }}
              >
                {[
                  { field: 'name', label: 'Name' },
                  { field: 'modified', label: 'Date modified' },
                  { field: 'extension', label: 'Type' },
                  { field: 'size', label: 'Size' },
                ].map((s) => (
                  <div
                    key={s.field}
                    className="win11-menu-item"
                    onClick={() => {
                      setSortBy(s.field);
                      setSortMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 12px',
                      fontSize: 'var(--font-size-xs)',
                      cursor: 'pointer',
                      color: sortBy === s.field ? 'var(--color-accent)' : 'var(--color-text-primary)',
                    }}
                  >
                    <span>{s.label}</span>
                    {sortBy === s.field && <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* View Mode Switcher */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                setViewMenuOpen(!viewMenuOpen);
                setSortMenuOpen(false);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>{viewMode === 'details' ? '≡' : viewMode === 'grid' ? '⊞' : '☰'}</span>
              <span>View</span>
              <span style={{ fontSize: '10px' }}>▾</span>
            </button>

            {viewMenuOpen && (
              <div
                className="win11-menu"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: '4px',
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  width: '150px',
                  zIndex: 100,
                  padding: '4px 0',
                }}
              >
                {[
                  { mode: 'details' as const, icon: '≡', label: 'Details' },
                  { mode: 'grid' as const, icon: '⊞', label: 'Large Grid' },
                  { mode: 'list' as const, icon: '☰', label: 'List' },
                ].map((v) => (
                  <div
                    key={v.mode}
                    className="win11-menu-item"
                    onClick={() => {
                      setViewMode(v.mode);
                      setViewMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 12px',
                      fontSize: 'var(--font-size-xs)',
                      cursor: 'pointer',
                      color: viewMode === v.mode ? 'var(--color-accent)' : 'var(--color-text-primary)',
                    }}
                  >
                    <span>{v.icon}</span>
                    <span>{v.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ width: '1px', height: '16px', background: 'var(--color-border)', margin: '0 4px' }} />

          {/* Details / Preview Pane Toggle */}
          <button
            className={`btn btn-ghost btn-sm ${detailsPaneOpen ? 'active' : ''}`}
            onClick={toggleDetailsPane}
            title={detailsPaneOpen ? 'Hide Details Pane' : 'Show Details Pane (Ctrl+Shift+P)'}
            style={{
              background: detailsPaneOpen ? 'var(--color-accent-dim)' : undefined,
              color: detailsPaneOpen ? 'var(--color-accent)' : undefined,
            }}
          >
            ⓘ Details
          </button>
        </div>
      </div>

      {/* ─── 3. Main Browsing Canvas & Details Pane ────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* File Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3) var(--space-4)' }}>
          {loading ? (
            <div className="empty-state">
              <div className="empty-icon animate-pulse" style={{ fontSize: '32px' }}>📂</div>
              <div className="empty-title">Reading directory...</div>
            </div>
          ) : error ? (
            <div className="empty-state">
              <div className="empty-icon" style={{ fontSize: '32px' }}>🚫</div>
              <div className="empty-title">Access Denied</div>
              <div className="empty-description">{error}</div>
              <button className="btn btn-secondary btn-sm" onClick={goUp} style={{ marginTop: 'var(--space-2)' }}>
                Go Up
              </button>
            </div>
          ) : !currentPath ? (
            /* ─── This PC: Drives View ─── */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Devices and Drives ({drives.length})
                </h3>
              </div>
              <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
                {drives.map((drive) => {
                  const usedPercent = drive.totalSize > 0 ? (drive.usedSpace / drive.totalSize) * 100 : 0;
                  return (
                    <div
                      key={drive.letter}
                      className="stat-card win11-drive-card"
                      onClick={() => navigateTo(drive.letter + '\\')}
                      style={{ cursor: 'pointer', padding: 'var(--space-3)', transition: 'border-color 0.15s, background 0.15s' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <span style={{ fontSize: '28px', flexShrink: 0 }}>💿</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {drive.label ? `${drive.label} (${drive.letter})` : drive.letter}
                          </div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                            {drive.type || 'Local Disk'}
                          </div>
                        </div>
                      </div>

                      {drive.totalSize > 0 && (
                        <div style={{ marginTop: 'var(--space-2)' }}>
                          <div className="progress-bar" style={{ height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}>
                            <div
                              className="progress-fill"
                              style={{
                                width: `${usedPercent}%`,
                                height: '100%',
                                background: usedPercent > 90 ? 'var(--color-error)' : usedPercent > 70 ? 'var(--color-warning)' : 'var(--color-accent)',
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                            <span>{formatSize(drive.freeSpace)} free</span>
                            <span>{formatSize(drive.totalSize)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : filteredEntries.length === 0 ? (
            /* ─── Empty Folder State ─── */
            <div className="empty-state" style={{ padding: 'var(--space-8) 0' }}>
              <div className="empty-icon" style={{ fontSize: '36px', opacity: 0.7 }}>📂</div>
              <div className="empty-title">This folder is empty</div>
              <div className="empty-description" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                {searchFilter ? `No files match "${searchFilter}"` : 'Drop files here or click "New folder" to begin'}
              </div>
            </div>
          ) : viewMode === 'details' ? (
            /* ─── Details View (Windows 11 Column Table) ─── */
            <div className="file-list win11-details-table" style={{ width: '100%' }}>
              {/* Header */}
              <div
                className="file-list-header"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(200px, 2.5fr) 130px 140px 110px',
                  padding: '6px 12px',
                  borderBottom: '1px solid var(--color-border)',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  color: 'var(--color-text-secondary)',
                  userSelect: 'none',
                }}
              >
                <div
                  onClick={() => setSortBy('name')}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span>Name</span>
                  {sortBy === 'name' && <span style={{ fontSize: '10px' }}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                </div>
                <div
                  onClick={() => setSortBy('modified')}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span>Date modified</span>
                  {sortBy === 'modified' && <span style={{ fontSize: '10px' }}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                </div>
                <div
                  onClick={() => setSortBy('extension')}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span>Type</span>
                  {sortBy === 'extension' && <span style={{ fontSize: '10px' }}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                </div>
                <div
                  onClick={() => setSortBy('size')}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}
                >
                  <span>Size</span>
                  {sortBy === 'size' && <span style={{ fontSize: '10px' }}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                </div>
              </div>

              {/* Rows */}
              {filteredEntries.map((entry) => {
                const isSelected = selectedFiles.has(entry.path);
                return (
                  <div
                    key={entry.path}
                    className={`file-list-item win11-row ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => handleEntryClick(e, entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(200px, 2.5fr) 130px 140px 110px',
                      padding: '5px 12px',
                      alignItems: 'center',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      border: isSelected ? '1px solid rgba(180, 255, 50, 0.4)' : '1px solid transparent',
                      background: isSelected ? 'rgba(180, 255, 50, 0.08)' : undefined,
                    }}
                  >
                    <div className="file-list-name" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <span style={{ fontSize: '16px', flexShrink: 0 }}>{getFileIcon(entry)}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)' }}>
                        {entry.name}
                      </span>
                    </div>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                      {formatDate(entry.modified)}
                    </span>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                      {entry.isDirectory ? 'File folder' : entry.extension ? `${entry.extension.toUpperCase().replace('.', '')} File` : 'File'}
                    </span>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', textAlign: 'right' }}>
                      {entry.isFile ? formatSize(entry.size) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : viewMode === 'grid' ? (
            /* ─── Large Grid View ─── */
            <div className="file-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--space-3)' }}>
              {filteredEntries.map((entry) => {
                const isSelected = selectedFiles.has(entry.path);
                return (
                  <div
                    key={entry.path}
                    className={`file-card ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => handleEntryClick(e, entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    style={{
                      padding: 'var(--space-3)',
                      textAlign: 'center',
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle)',
                      background: isSelected ? 'var(--color-accent-dim)' : 'var(--color-bg-secondary)',
                    }}
                  >
                    <div style={{ fontSize: '38px', marginBottom: '4px' }}>{getFileIcon(entry)}</div>
                    <div
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'var(--color-text-primary)',
                      }}
                      title={entry.name}
                    >
                      {entry.name}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                      {entry.isFile ? formatSize(entry.size) : 'Folder'}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ─── Compact List View ─── */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px' }}>
              {filteredEntries.map((entry) => {
                const isSelected = selectedFiles.has(entry.path);
                return (
                  <div
                    key={entry.path}
                    onClick={(e) => handleEntryClick(e, entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 8px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--color-accent-dim)' : 'transparent',
                      border: isSelected ? '1px solid var(--color-accent)' : '1px solid transparent',
                    }}
                  >
                    <span style={{ fontSize: '14px', flexShrink: 0 }}>{getFileIcon(entry)}</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── 4. Right-Hand Preview & Properties Drawer ───────────────────── */}
        {detailsPaneOpen && (
          <aside
            className="win11-details-pane"
            style={{
              width: '290px',
              borderLeft: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              overflowY: 'auto',
              padding: 'var(--space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                Details & Intelligence
              </span>
              <button className="btn btn-ghost btn-sm" onClick={toggleDetailsPane} style={{ padding: '1px 4px', fontSize: '11px' }}>
                ✕
              </button>
            </div>

            {activeFileDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {/* Visual Icon / Preview */}
                <div
                  style={{
                    background: 'var(--color-bg-primary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    height: '140px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '56px',
                  }}
                >
                  {getFileIcon(activeFileDetails)}
                </div>

                {/* Primary Name & Size */}
                <div>
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>
                    {activeFileDetails.name}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    {activeFileDetails.isFile ? formatSize(activeFileDetails.size) : 'Folder'} • {activeFileDetails.extension || 'File'}
                  </div>
                </div>

                {/* Standard Windows Properties */}
                <div style={{ fontSize: 'var(--font-size-xs)', display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>Modified:</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{formatDate(activeFileDetails.modified)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>Created:</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{formatDate(activeFileDetails.created)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>Read-only:</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{activeFileDetails.isReadOnly ? 'Yes' : 'No'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>Path:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>
                      {activeFileDetails.path}
                    </span>
                  </div>
                </div>

                {/* ─── Nexora Local AI Insights ─── */}
                <div
                  style={{
                    background: 'rgba(180, 255, 50, 0.04)',
                    border: '1px solid rgba(180, 255, 50, 0.2)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-3)',
                    marginTop: 'var(--space-2)',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--color-accent)', marginBottom: '8px' }}>
                    <span>⚡</span>
                    <span>Nexora Intelligence</span>
                  </div>

                  {activeFileDetails.indexed ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {/* SHA-256 Hash */}
                      {activeFileDetails.indexed.hash_sha256 && (
                        <div>
                          <span style={{ color: 'var(--color-text-tertiary)', display: 'block', fontSize: '10px' }}>SHA-256 Hash:</span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '9px',
                              color: 'var(--color-text-primary)',
                              wordBreak: 'break-all',
                              cursor: 'pointer',
                            }}
                            title="Click to copy SHA-256 hash"
                            onClick={() => {
                              navigator.clipboard.writeText(activeFileDetails.indexed.hash_sha256);
                              toast.info('Hash copied to clipboard');
                            }}
                          >
                            {activeFileDetails.indexed.hash_sha256.substring(0, 16)}...
                          </span>
                        </div>
                      )}

                      {/* Dimensions / Camera */}
                      {activeFileDetails.indexed.width && activeFileDetails.indexed.height && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--color-text-tertiary)' }}>Dimensions:</span>
                          <span>{activeFileDetails.indexed.width} × {activeFileDetails.indexed.height} px</span>
                        </div>
                      )}

                      {activeFileDetails.indexed.camera_model && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--color-text-tertiary)' }}>Camera:</span>
                          <span>{activeFileDetails.indexed.camera_make ? `${activeFileDetails.indexed.camera_make} ` : ''}{activeFileDetails.indexed.camera_model}</span>
                        </div>
                      )}

                      {/* Associated People */}
                      {activeFileDetails.indexed.people && activeFileDetails.indexed.people.length > 0 && (
                        <div>
                          <span style={{ color: 'var(--color-text-tertiary)', display: 'block', marginBottom: '2px' }}>People Identified:</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {activeFileDetails.indexed.people.map((p: string, i: number) => (
                              <span
                                key={i}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  background: 'var(--color-accent-dim)',
                                  color: 'var(--color-accent)',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                }}
                              >
                                👤 {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Document Details */}
                      {activeFileDetails.indexed.word_count !== undefined && activeFileDetails.indexed.word_count !== null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--color-text-tertiary)' }}>Word Count:</span>
                          <span>{activeFileDetails.indexed.word_count.toLocaleString()} words</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--color-text-tertiary)', fontSize: '11px', lineHeight: 1.4 }}>
                      Not yet indexed in Nexora local intelligence database. Click "Index Folder" to analyze faces, metadata & duplicates.
                    </div>
                  )}

                  {/* AI Vision Classification Results */}
                  {classificationResult && classificationResult.filePath === activeFileDetails.path && (
                    <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px dashed rgba(180, 255, 50, 0.2)' }}>
                      <span style={{ color: 'var(--color-accent)', display: 'block', fontSize: '10px', fontWeight: 600, marginBottom: '4px' }}>
                        Neural Image Tags:
                      </span>
                      {classificationResult.top_classes.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {classificationResult.top_classes.map((cls, idx) => (
                            <span
                              key={idx}
                              style={{
                                padding: '2px 6px',
                                borderRadius: '3px',
                                background: 'rgba(180, 255, 50, 0.12)',
                                color: 'var(--color-accent)',
                                fontSize: '10px',
                                fontWeight: 500,
                              }}
                            >
                              🏷 {cls.label} ({Math.round(cls.confidence * 100)}%)
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>No tags detected.</span>
                      )}
                    </div>
                  )}

                  {/* AI OCR Text Results */}
                  {ocrResult && ocrResult.filePath === activeFileDetails.path && (
                    <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px dashed rgba(180, 255, 50, 0.2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--color-accent)', fontSize: '10px', fontWeight: 600 }}>
                          Extracted Text (OCR):
                        </span>
                        {ocrResult.text && (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '2px 4px', fontSize: '9px' }}
                            onClick={() => {
                              navigator.clipboard.writeText(ocrResult.text);
                              toast.info('Extracted text copied to clipboard');
                            }}
                          >
                            Copy Text
                          </button>
                        )}
                      </div>
                      {ocrResult.text ? (
                        <div
                          style={{
                            background: 'rgba(0,0,0,0.2)',
                            padding: '6px',
                            borderRadius: '4px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '9px',
                            maxHeight: '100px',
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {ocrResult.text}
                        </div>
                      ) : (
                        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>No text recognized in image.</span>
                      )}
                    </div>
                  )}

                  {/* Local AI Interactive Action Triggers */}
                  <div style={{ display: 'flex', gap: '4px', marginTop: 'var(--space-3)' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, fontSize: '10px', padding: '4px 6px' }}
                      disabled={isClassifying}
                      onClick={() => handleRunClassification(activeFileDetails.path)}
                      title="Run MobileNetV2 image classification to generate semantic tags"
                    >
                      {isClassifying ? 'Analyzing...' : '🏷 AI Vision Tag'}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, fontSize: '10px', padding: '4px 6px' }}
                      disabled={isExtractingOcr}
                      onClick={() => handleRunOcr(activeFileDetails.path)}
                      title="Extract printed text via neural optical character recognition"
                    >
                      {isExtractingOcr ? 'Extracting...' : '📄 Run OCR'}
                    </button>
                  </div>
                </div>

                {/* Quick In-Place Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'var(--space-2)' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => api().fs.openFile(activeFileDetails.path)}
                    style={{ width: '100%' }}
                  >
                    Open File
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => api().fs.revealInExplorer(activeFileDetails.path)}
                    style={{ width: '100%' }}
                  >
                    Reveal in Windows Explorer
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 'var(--space-8) 0', fontSize: 'var(--font-size-xs)' }}>
                Select an item to view its metadata, EXIF details, and AI tags.
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ─── 5. Status Bar ─────────────────────────────────────────────────── */}
      <div
        className="win11-status-bar"
        style={{
          padding: '4px var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
          fontSize: '11px',
          color: 'var(--color-text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--color-bg-primary)',
          flexShrink: 0,
        }}
      >
        <div>
          <span>{filteredEntries.length} items</span>
          {selectedFiles.size > 0 && (
            <span style={{ marginLeft: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
              • {selectedFiles.size} selected {totalSelectedSize > 0 ? `(${formatSize(totalSelectedSize)})` : ''}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{currentPath || 'This PC'}</span>
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              className={`btn btn-ghost btn-sm ${viewMode === 'details' ? 'active' : ''}`}
              onClick={() => setViewMode('details')}
              title="Details view"
              style={{
                padding: '2px 5px',
                fontSize: '11px',
                color: viewMode === 'details' ? 'var(--color-accent)' : undefined,
              }}
            >
              ≡
            </button>
            <button
              className={`btn btn-ghost btn-sm ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Large grid view"
              style={{
                padding: '2px 5px',
                fontSize: '11px',
                color: viewMode === 'grid' ? 'var(--color-accent)' : undefined,
              }}
            >
              ⊞
            </button>
          </div>
        </div>
      </div>

      {/* ─── Context Menu ─────────────────────────────────────────────────── */}
      {contextMenu.visible && (
        <div
          className="win11-context-menu"
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            width: '200px',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
            padding: '4px 0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entry ? (
            <>
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  if (contextMenu.entry?.isDirectory) navigateTo(contextMenu.entry.path);
                  else if (contextMenu.entry) api().fs.openFile(contextMenu.entry.path);
                }}
              >
                <span>Open</span>
                <span className="shortcut">Enter</span>
              </div>
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  if (contextMenu.entry) api().fs.revealInExplorer(contextMenu.entry.path);
                }}
              >
                <span>Reveal in Explorer</span>
              </div>
              <div className="win11-menu-divider" />
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  cutSelection();
                }}
              >
                <span>Cut</span>
                <span className="shortcut">Ctrl+X</span>
              </div>
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  copySelection();
                }}
              >
                <span>Copy</span>
                <span className="shortcut">Ctrl+C</span>
              </div>
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  if (contextMenu.entry) {
                    navigator.clipboard.writeText(contextMenu.entry.path);
                    toast.info('Path copied to clipboard');
                  }
                }}
              >
                <span>Copy as path</span>
                <span className="shortcut">Ctrl+Shift+C</span>
              </div>
              <div className="win11-menu-divider" />
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  if (contextMenu.entry) {
                    setRenameTarget(contextMenu.entry);
                    setRenameValue(contextMenu.entry.name);
                    setRenameModalOpen(true);
                  }
                }}
              >
                <span>Rename</span>
                <span className="shortcut">F2</span>
              </div>
              <div
                className="win11-menu-item"
                style={{ color: 'var(--color-error)' }}
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  if (contextMenu.entry) {
                    setDeleteTargets([contextMenu.entry.path]);
                    setDeleteConfirmModalOpen(true);
                  }
                }}
              >
                <span>Delete</span>
                <span className="shortcut">Del</span>
              </div>
              <div className="win11-menu-divider" />
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  if (contextMenu.entry) {
                    loadFileDetails(contextMenu.entry.path);
                    if (!detailsPaneOpen) toggleDetailsPane();
                  }
                }}
              >
                <span>Properties / Details</span>
                <span className="shortcut">Alt+Enter</span>
              </div>
              {!contextMenu.entry.isDirectory && (
                <>
                  <div className="win11-menu-divider" />
                  <div
                    className="win11-menu-item"
                    onClick={() => {
                      const entryPath = contextMenu.entry!.path;
                      setContextMenu((s) => ({ ...s, visible: false }));
                      loadFileDetails(entryPath);
                      if (!detailsPaneOpen) toggleDetailsPane();
                      handleRunClassification(entryPath);
                    }}
                  >
                    <span>⚡ AI Vision Tag (MobileNetV2)</span>
                  </div>
                  <div
                    className="win11-menu-item"
                    onClick={() => {
                      const entryPath = contextMenu.entry!.path;
                      setContextMenu((s) => ({ ...s, visible: false }));
                      loadFileDetails(entryPath);
                      if (!detailsPaneOpen) toggleDetailsPane();
                      handleRunOcr(entryPath);
                    }}
                  >
                    <span>📄 AI Extract Text (OCR)</span>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  if (currentPath) setNewFolderModalOpen(true);
                }}
              >
                <span>New folder</span>
              </div>
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  pasteClipboard();
                }}
                style={{ opacity: !clipboard ? 0.5 : 1 }}
              >
                <span>Paste</span>
                <span className="shortcut">Ctrl+V</span>
              </div>
              <div className="win11-menu-divider" />
              <div
                className="win11-menu-item"
                onClick={() => {
                  setContextMenu((s) => ({ ...s, visible: false }));
                  refresh();
                }}
              >
                <span>Refresh</span>
                <span className="shortcut">F5</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Modal: New Folder ────────────────────────────────────────────── */}
      {newFolderModalOpen && (
        <div className="modal-overlay" onClick={() => setNewFolderModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '380px' }}>
            <div className="modal-header">
              <h3 className="modal-title">New Folder</h3>
              <button className="btn btn-ghost" onClick={() => setNewFolderModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>
                Folder Name
              </label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                style={{ width: '100%' }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setNewFolderModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateFolder}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Rename ────────────────────────────────────────────────── */}
      {renameModalOpen && renameTarget && (
        <div className="modal-overlay" onClick={() => setRenameModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '380px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Rename</h3>
              <button className="btn btn-ghost" onClick={() => setRenameModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>
                New Name
              </label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleExecuteRename()}
                style={{ width: '100%' }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRenameModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleExecuteRename}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Safe Delete Confirmation ──────────────────────────────── */}
      {deleteConfirmModalOpen && (
        <div className="modal-overlay" onClick={() => !isDeleting && setDeleteConfirmModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '420px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--color-error)' }}>Recycle Items</h3>
              <button className="btn btn-ghost" onClick={() => setDeleteConfirmModalOpen(false)} disabled={isDeleting}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
                Are you sure you want to move {deleteTargets.length === 1 ? 'this item' : `these ${deleteTargets.length} items`} to the Windows Recycle Bin?
              </p>
              <div
                style={{
                  maxHeight: '120px',
                  overflowY: 'auto',
                  background: 'var(--color-bg-primary)',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {deleteTargets.map((p) => (
                  <div key={p} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    • {p.split(/[\\/]/).pop()}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-2)' }}>
                Files can be restored at any time from your Windows Recycle Bin.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirmModalOpen(false)} disabled={isDeleting}>
                Cancel
              </button>
              <button
                className="btn btn-sm"
                onClick={handleExecuteDelete}
                disabled={isDeleting}
                style={{ background: 'var(--color-error)', color: '#fff' }}
              >
                {isDeleting ? 'Moving to Recycle Bin...' : 'Move to Recycle Bin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
