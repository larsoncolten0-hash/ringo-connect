"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, ExternalLink } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";
import WhatsAppButton from "@/components/WhatsAppButton";

// "Latest Music" / "Latest Beats" — a handful of featured tracks, not a
// streaming player. Play either toggles the creator's own uploaded audio
// file (a single shared <audio> element, so only one track plays at a
// time) or, when there's no upload, opens wherever the track actually
// lives (Spotify, YouTube, Audiomack…) in a new tab.
export default function MusicSection({
  t,
  title,
  tracks,
  artistName,
  accent,
  textColor,
  radiusClass,
  borderTint,
  currency,
  whatsappNumber,
}: {
  t: Translations;
  title: string;
  tracks: any[];
  artistName: string;
  accent: string;
  textColor: string;
  radiusClass: string;
  borderTint: string;
  currency: string;
  whatsappNumber?: string | null;
}) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (tracks.length === 0) return null;

  const togglePlay = (track: any) => {
    if (!track.audio_url) {
      if (track.external_url) window.open(track.external_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (playingId === track.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = track.audio_url;
    audioRef.current.onended = () => setPlayingId(null);
    audioRef.current.play().catch(() => setPlayingId(null));
    setPlayingId(track.id);
  };

  return (
    <div id="music" className="flex flex-col gap-3 scroll-mt-6">
      <p className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
        {title}
      </p>

      <div className="flex flex-col gap-2.5">
        {tracks
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((track) => {
            const isPlaying = playingId === track.id;
            const canBuy = track.buy_url || track.price;
            return (
              <div
                key={track.id}
                className={`flex items-center gap-3 p-3 ${radiusClass}`}
                style={{ border: `1px solid ${borderTint}` }}
              >
                {track.cover_image_url ? (
                  <img src={track.cover_image_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                ) : (
                  <div
                    className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: hexToRgba(accent, 0.12) }}
                  >
                    <Play size={18} style={{ color: accent }} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{track.title}</p>
                  <p className="text-xs truncate" style={{ opacity: 0.65 }}>
                    {track.artist_name || artistName}
                    {track.duration ? ` · ${track.duration}` : ""}
                  </p>
                </div>

                {(track.audio_url || track.external_url) && (
                  <button
                    onClick={() => togglePlay(track)}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition active:scale-90"
                    style={{ backgroundColor: accent, color: "#fff" }}
                  >
                    {track.audio_url ? (
                      isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />
                    ) : (
                      <ExternalLink size={14} />
                    )}
                  </button>
                )}

                {canBuy &&
                  (track.buy_url ? (
                    <a
                      href={track.buy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs font-medium px-3 py-2 rounded-full"
                      style={{ border: `1.5px solid ${accent}`, color: accent }}
                    >
                      {track.price ? formatPrice(track.price, currency) : t.music.buyLabel}
                    </a>
                  ) : (
                    whatsappNumber && (
                      <div className="shrink-0">
                        <WhatsAppButton
                          number={whatsappNumber}
                          message={track.whatsapp_message || t.music.buyTrackWhatsappMessage(track.title)}
                          compact
                          radiusClass="rounded-full"
                        />
                      </div>
                    )
                  ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
