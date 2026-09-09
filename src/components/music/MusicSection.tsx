"use client";

import { Play, Pause, ExternalLink } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";
import WhatsAppButton from "@/components/WhatsAppButton";
import EqualizerBars from "./EqualizerBars";

// "Latest Music" / "Latest Beats" — a handful of featured tracks, not a
// streaming player. Play either toggles the creator's own uploaded audio
// file or, when there's no upload, opens wherever the track actually
// lives (Spotify, YouTube, Audiomack…) in a new tab. playingId/onTogglePlay
// come from useTrackPlayback, owned by ProfileView and shared with
// PinnedSpotlight — one real <audio> element for the whole page, so a
// pinned track and its entry here never play on top of each other.
export default function MusicSection({
  t,
  title,
  tracks,
  artistName,
  accent,
  radiusClass,
  borderTint,
  currency,
  whatsappNumber,
  playingId,
  onTogglePlay,
}: {
  t: Translations;
  title: string;
  tracks: any[];
  artistName: string;
  accent: string;
  radiusClass: string;
  borderTint: string;
  currency: string;
  whatsappNumber?: string | null;
  playingId: string | null;
  onTogglePlay: (track: any) => void;
}) {
  if (tracks.length === 0) return null;

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
                className={`flex items-center gap-3 p-3 transition ${radiusClass}`}
                style={{
                  border: `1px solid ${isPlaying ? accent : borderTint}`,
                  backgroundColor: isPlaying ? hexToRgba(accent, 0.06) : "transparent",
                }}
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
                  <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                    {track.title}
                    {isPlaying && <EqualizerBars color={accent} />}
                  </p>
                  <p className="text-xs truncate" style={{ opacity: 0.65 }}>
                    {track.artist_name || artistName}
                    {track.duration ? ` · ${track.duration}` : ""}
                  </p>
                </div>

                {(track.audio_url || track.external_url) && (
                  <button
                    onClick={() => onTogglePlay(track)}
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
