'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Check,
  AlertCircle,
  Sparkles,
  Image as ImageIcon,
  Maximize2,
  Trash2,
  Loader2,
} from 'lucide-react';
import {
  cropTransparentBounds,
  validateCustomLogoFile,
  ProcessedLogoCanvasResult,
} from '@/lib/artwork/logo-cropper';

interface LogoUploaderProps {
  animeTitle: string;
  onUploadProcessedLogo: (payload: {
    blob: Blob;
    fileName: string;
    mimeType: 'image/png' | 'image/webp';
    width: number;
    height: number;
  }) => Promise<void>;
  disabled?: boolean;
}

/**
 * Verifies the binary file header (magic bytes) to ensure the file is a genuine
 * PNG (89 50 4E 47 0D 0A 1A 0A) or WebP (RIFF....WEBP) image.
 */
async function verifyImageMagicBytes(file: File): Promise<boolean> {
  try {
    const slice = file.slice(0, 16);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 12) return false;

    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;

    if (isPng) return true;

    // WebP magic bytes: "RIFF" at 0..3 and "WEBP" at 8..11
    const isWebp =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;

    return isWebp;
  } catch {
    return false;
  }
}

export function LogoUploader({
  animeTitle,
  onUploadProcessedLogo,
  disabled = false,
}: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadLockRef = useRef(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [autoTrim, setAutoTrim] = useState(true);
  const [outputFormat, setOutputFormat] = useState<'image/png' | 'image/webp'>(
    'image/png'
  );
  const [processed, setProcessed] = useState<ProcessedLogoCanvasResult | null>(
    null
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(
    async (
      file: File,
      trimEnabled: boolean,
      format: 'image/png' | 'image/webp'
    ) => {
      setError(null);
      const validationError = validateCustomLogoFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      const validMagic = await verifyImageMagicBytes(file);
      if (!validMagic) {
        setError(
          'Invalid file binary signature. Only authentic PNG or WebP images are permitted.'
        );
        return;
      }

      setIsProcessing(true);
      try {
        const result = await cropTransparentBounds(file, {
          autoTrim: trimEnabled,
          paddingPx: 6,
          outputType: format,
        });

        if (result.width < 60 || result.height < 20) {
          setError(
            `Logo dimensions (${result.width}×${result.height}px) are too small. Minimum recommended size is 60×20px.`
          );
          setProcessed(null);
          return;
        }

        setProcessed(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to process logo file'
        );
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const handleFilePicked = async (file: File | null | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    await processFile(file, autoTrim, outputFormat);
  };

  const handleToggleTrim = async (nextTrim: boolean) => {
    setAutoTrim(nextTrim);
    if (selectedFile) {
      await processFile(selectedFile, nextTrim, outputFormat);
    }
  };

  const handleFormatChange = async (nextFormat: 'image/png' | 'image/webp') => {
    setOutputFormat(nextFormat);
    if (selectedFile) {
      await processFile(selectedFile, autoTrim, nextFormat);
    }
  };

  const handleConfirmUpload = async () => {
    if (!processed || !selectedFile || disabled || uploadLockRef.current) return;
    uploadLockRef.current = true;
    setIsUploading(true);
    setError(null);

    try {
      await onUploadProcessedLogo({
        blob: processed.blob,
        fileName: selectedFile.name,
        mimeType: outputFormat,
        width: processed.width,
        height: processed.height,
      });
      setSelectedFile(null);
      setProcessed(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to upload custom logo to Firebase Storage'
      );
    } finally {
      setIsUploading(false);
      uploadLockRef.current = false;
    }
  };

  const handleClear = () => {
    if (isUploading) return;
    setSelectedFile(null);
    setProcessed(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Upload size={16} className="text-white" />
            <span>Upload Custom Transparent Logo</span>
          </h3>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Supports transparent PNG & WebP up to 5MB with automatic empty-border trimming.
          </p>
        </div>

        {selectedFile && !isUploading && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-[#A0A0A0] hover:text-white flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] cursor-pointer"
          >
            <Trash2 size={13} />
            <span>Discard</span>
          </button>
        )}
      </div>

      {/* Dropzone */}
      {!processed && !isProcessing && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            handleFilePicked(file);
          }}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
            isDragging
              ? 'border-white bg-white/5'
              : 'border-[#292929] hover:border-[#707070] bg-[#141414]/40'
          } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/webp"
            className="hidden"
            onChange={(e) => handleFilePicked(e.target.files?.[0])}
          />
          <div className="w-12 h-12 rounded-full bg-[#141414] border border-[#292929] flex items-center justify-center mx-auto mb-3">
            <ImageIcon size={20} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-white">
            Drag & drop transparent logo for <span className="underline">{animeTitle}</span>
          </p>
          <p className="text-xs text-[#A0A0A0] mt-1 font-mono">
            PNG or WebP • Max 5MB • Transparent alpha channel verified
          </p>
        </div>
      )}

      {isProcessing && (
        <div className="border border-[#292929] rounded-xl p-8 flex flex-col items-center justify-center gap-2 bg-[#141414]/40">
          <Loader2 size={24} className="text-white animate-spin" />
          <span className="text-xs text-[#A0A0A0] font-mono">
            Analyzing alpha channel & trimming transparent bounds...
          </span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg bg-white/5 border border-white/30 flex items-start gap-2.5 text-xs text-white">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Processed Preview & Controls */}
      {processed && (
        <div className="space-y-4">
          {/* Checkerboard + Dark Hero Preview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-[#292929] p-4 bg-[#141414] flex flex-col items-center justify-center min-h-[140px] relative overflow-hidden">
              <span className="absolute top-2 left-2.5 text-[10px] font-mono uppercase tracking-wider text-[#707070]">
                Alpha Bounds Preview
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={processed.dataUrl}
                alt="Processed logo preview"
                className="max-h-24 max-w-full object-contain mt-3"
              />
            </div>

            <div className="rounded-lg border border-[#292929] p-4 bg-gradient-to-tr from-black via-[#0A0A0A] to-[#1F1F1F] flex flex-col items-center justify-center min-h-[140px] relative overflow-hidden">
              <span className="absolute top-2 left-2.5 text-[10px] font-mono uppercase tracking-wider text-[#707070]">
                Dark Hero Contrast Check
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={processed.dataUrl}
                alt="Dark hero preview"
                className="max-h-24 max-w-full object-contain mt-3 drop-shadow-[0_6px_20px_rgba(0,0,0,0.85)]"
              />
            </div>
          </div>

          {/* Metadata & Options Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-[#141414] border border-[#292929] text-xs">
            <div className="flex flex-wrap items-center gap-3 font-mono text-[#A0A0A0]">
              <span className="flex items-center gap-1 text-white">
                <Maximize2 size={12} />
                {processed.width} × {processed.height}px
              </span>
              {processed.trimmedPixels > 0 && (
                <span className="text-white bg-white/10 px-2 py-0.5 rounded">
                  Auto-trimmed ({processed.originalWidth}×{processed.originalHeight} → {processed.width}×{processed.height})
                </span>
              )}
              <span>
                {(processed.blob.size / 1024).toFixed(1)} KB
              </span>
              <span>
                {processed.hasTransparency ? 'Alpha Channel OK' : 'Opaque Warning'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTrim}
                  onChange={(e) => handleToggleTrim(e.target.checked)}
                  className="accent-white"
                />
                <Sparkles size={13} />
                <span>Auto-Trim Borders</span>
              </label>

              <select
                value={outputFormat}
                onChange={(e) =>
                  handleFormatChange(e.target.value as 'image/png' | 'image/webp')
                }
                className="bg-[#0A0A0A] border border-[#292929] rounded px-2 py-1 text-xs text-white font-mono"
              >
                <option value="image/png">PNG</option>
                <option value="image/webp">WebP</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={isUploading || disabled}
              onClick={handleConfirmUpload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black font-bold text-xs hover:bg-[#E5E5E5] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isUploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Uploading to Firebase Storage...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Save & Activate Custom Logo</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
