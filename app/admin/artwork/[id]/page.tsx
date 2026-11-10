import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ArtworkManager } from '@/components/admin/ArtworkManager';

export default async function AdminAnimeArtworkStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const hoshikaId = parseInt(id, 10) || 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs font-mono">
          <Link
            href="/admin/artwork"
            className="inline-flex items-center gap-1.5 text-[#A0A0A0] hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to Artwork Catalogue</span>
          </Link>
          <span className="text-[#292929]">/</span>
          <Link
            href="/admin/missing-logos"
            className="text-[#A0A0A0] hover:text-white transition-colors"
          >
            Missing Logo Scanner
          </Link>
        </div>
      </div>

      <ArtworkManager hoshikaId={hoshikaId} />
    </div>
  );
}
