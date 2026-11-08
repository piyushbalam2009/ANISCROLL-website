'use client';

import React from 'react';
import Image from 'next/image';
import { User } from 'lucide-react';
import { HoshikaCharacter } from '@/types/anime';

interface CharacterListProps {
  characters?: HoshikaCharacter[];
}

export function CharacterList({ characters = [] }: CharacterListProps) {
  if (!characters || characters.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white tracking-wide">
        Characters & Voice Actors
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {characters.slice(0, 12).map((char) => (
          <div
            key={char.id}
            className="flex items-center justify-between p-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-[#404040] transition-colors"
          >
            {/* Character Info */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-[#0A0A0A] shrink-0 border border-[#292929]">
                {char.avatar ? (
                  <Image
                    src={char.avatar}
                    alt={char.name}
                    fill
                    sizes="44px"
                    className="object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#707070]">
                    <User size={16} />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate" title={char.name}>
                  {char.name}
                </div>
                <div className="text-[10px] text-[#707070] uppercase">
                  {char.role || 'Character'}
                </div>
              </div>
            </div>

            {/* Voice Actor Info */}
            {char.seiyuu && (
              <div className="flex items-center gap-2 text-right min-w-0 pl-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#A0A0A0] truncate" title={char.seiyuu.name}>
                    {char.seiyuu.name}
                  </div>
                  <div className="text-[10px] text-[#707070] uppercase">
                    Japanese
                  </div>
                </div>
                <div className="relative w-9 h-9 rounded-full overflow-hidden bg-[#0A0A0A] shrink-0 border border-[#292929]">
                  {char.seiyuu.avatar ? (
                    <Image
                      src={char.seiyuu.avatar}
                      alt={char.seiyuu.name}
                      fill
                      sizes="36px"
                      className="object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#707070]">
                      <User size={14} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
