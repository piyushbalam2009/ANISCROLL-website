'use client';

import React, { useState, useRef } from 'react';
import Image from 'next/image';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileImage,
  X,
} from 'lucide-react';
import { CustomLogoItem } from '@/types/artwork';
import { uploadCustomAnimeLogoFile } from '@/lib/admin/admin-firestore';

interface LogoUploaderProps {
  hoshikaId: number;
  animeTitle: string;
  onUploaded: (item: CustomLogoItem) => Promise<void> | void;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MIN_WIDTH_PX = 240;

/**
 * Sanitizes an SVG string by stripping script tags, event handlers, and foreignObject,
 * then rasterizes it cleanly onto an offscreen transparent canvas as a high-DPI PNG Blob
 * so Firebase Storage rules (image/png or image/webp) and Next.js <Image> work safely.
 */
async function sanitizeAndRasterizeSvgToPng(svgText: string): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const cleaned = svgText
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');

  const svgBlob = new Blob([cleaned], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid or corrupt SVG file'));
      el.src = objectUrl;
    });

    const width = Math.max(800, img.naturalWidth || 800);
    const height = Math.max(300, img.naturalHeight || 300);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))),
        'image/png',
        1.0
      );
    });

    return { blob: pngBlob, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function inspectRasterImage(file: File): Promise<{
  blob: Blob;
  mimeType: 'image/png' | 'image/webp';
  width: number;
  height: number;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Corrupt or unsupported image file'));
      el.src = objectUrl;
    });

    return {
      blob: file,
      mimeType: file.type === 'image/webp' ? 'image/webp' : 'image/png',
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function LogoUploader({
  hoshikaId,
  animeTitle,
  onUploaded,
}: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stagedFile, setStagedFile] = useState<{
    blob: Blob;
    fileName: string;
    mimeType: 'image/png' | 'image/webp';
    width: number;
    height: number;
    previewUrl: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleFileChange = async (file: File | null) => {
    setError(null);
    setSuccessMsg(null);
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setError('File exceeds maximum allowed size of 5 MB.');
      return;
    }

    const allowedTypes = ['image/png', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      setError('Only transparent .png, .webp, or .svg logo files are permitted.');
      return;
    }

    try {
      if (file.type === 'image/svg+xml') {
        const text = await file.text();
        const { blob, width, height } = await sanitizeAndRasterizeSvgToPng(text);
        const previewUrl = URL.createObjectURL(blob);
        setStagedFile({
          blob,
          fileName: file.name.replace(/\.svg$/i, '.png'),
          mimeType: 'image/png',
          width,
          height,
          previewUrl,
        });
      } else {
        const { blob, mimeType, width, height } = await inspectRasterImage(file);
        if (width < MIN_WIDTH_PX) {
          setError(
            `Logo width (${width}px) is too small. Minimum required width is ${MIN_WIDTH_PX}px.`
          );
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        setStagedFile({
          blob,
          fileName: file.name,
          mimeType,
          width,
          height,
          previewUrl,
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to validate logo file.'
      );
    }
  };

  const handleUploadConfirm = async () => {
    if (!stagedFile) return;
    setUploading(true);
    setError(null);

    try {
      const uploadedItem = await uploadCustomAnimeLogoFile({
        hoshikaId,
        file: stagedFile.blob,
        fileName: stagedFile.fileName,
        mimeType: stagedFile.mimeType,
        width: stagedFile.width,
        height: stagedFile.height,
      });

      await onUploaded(uploadedItem);
      URL.revokeObjectURL(stagedFile.previewUrl);
      setStagedFile(null);
      setSuccessMsg(
        `Uploaded ${uploadedItem.fileName} (${uploadedItem.width}×${uploadedItem.height}px) to Firebase Storage and set as primary logo.`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Upload to Firebase Storage failed.'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Upload size={15} />
            <span>Upload Custom Transparent Logo</span>
          </h3>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Supports transparent PNG, WebP, or sanitized SVG (max 5 MB, min {MIN_WIDTH_PX}px width). Stored at{' '}
            <code className="text-white font-mono">
              anime-logos/{hoshikaId}/
            </code>
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#141414] border border-white/40 text-xs text-white flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-lg bg-[#141414] border border-white text-xs text-white flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {!stagedFile ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0] || null;
            handleFileChange(f);
          }}
          className="border-2 border-dashed border-[#292929] hover:border-white/60 rounded-xl p-6 text-center cursor-pointer transition-colors bg-[#0F0F0F]"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
          />
          <FileImage size={28} className="mx-auto text-[#A0A0A0] mb-2" />
          <div className="text-xs sm:text-sm font-bold text-white">
            Click to select or drag & drop transparent logo for {animeTitle}
          </div>
          <div className="text-[11px] font-mono text-[#707070] mt-1">
            PNG • WEBP • SVG (Auto-Sanitized) • Max 5MB
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-mono text-white">
              Staged: <span className="font-bold">{stagedFile.fileName}</span> •{' '}
              {stagedFile.width}×{stagedFile.height}px •{' '}
              {Math.round(stagedFile.blob.size / 1024)} KB
            </div>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(stagedFile.previewUrl);
                setStagedFile(null);
              }}
              className="p-1 rounded bg-black border border-[#292929] text-[#A0A0A0] hover:text-white"
            >
              <X size={14} />
            </button>
          </div>

          <div className="relative h-32 w-full rounded-lg bg-[#050505] border border-[#292929] flex items-center justify-center p-4">
            <Image
              src={stagedFile.previewUrl}
              alt="Staged custom logo preview"
              fill
              sizes="400px"
              className="object-contain p-3"
              referrerPolicy="no-referrer"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(stagedFile.previewUrl);
                setStagedFile(null);
              }}
              className="px-4 py-2 rounded-lg bg-black border border-[#292929] text-xs font-medium text-[#A0A0A0] hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUploadConfirm}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Uploading to Firebase Storage...</span>
                </>
              ) : (
                <>
                  <Upload size={14} />
                  <span>Upload & Set as Primary Logo</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
