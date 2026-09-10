"use client";

import { Music, Play, Pause, ExternalLink, Lock } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";
import WhatsAppButton from "@/components/WhatsAppButton";
import EqualizerBars from "./EqualizerBars";

// Fixed near-black "player card" — deliberately not theme-driven (unlike
// the rest of the page, which respects the creator's own colors): this is
// what gives Latest Music its own visual identity sitting inside the
// lighter content area, matching the reference design's dark
// "now playing" treatment regardless of which accent color is chosen.
const CARD_BG = "#171009";
const CARD_TEXT = "#F5EFE4";

// "Latest Music" / "Latest Beats" — a handful of featured tracks, not a
// streaming player. Play either toggles the creator's own uploaded audio
// file or, when there's no upload, opens wherever the track actually
// lives (Spotify, YouTube, Audiomack…) in a new tab. playingId/progress/
// onTogglePlay come from useTrackPlayback, owned by ProfileView and shared
// with PinnedSpotlight — one real <audio> element for the whole page, so
// a pinned track and its entry here never play on top of each other, and
// the progress bar reflects real playback position, not a static prop.
export default function MusicSection({
  t,
  title,
  tracks,
  artistName,
  accent,
  currency,
  whatsappNumber,
  username,
  playingId,
  progress,
  onTogglePlay,
}: {
  t: Translations;
  title: string;
  tracks: any[];
  artistName: string;
  accent: string;
  currency: string;
  whatsappNumber?: string | null;
  username: string;
  playingId: string | null;
  progress: number;
  onTogglePlay: (track: any) => void;
}) {
  if (tracks.length === 0) return null;

  return (
    <div id="music" className="flex flex-col gap-3 scroll-mt-6">
      <p className="text-base font-bold flex items-center gap-2">
        <Music size={17} style={{ color: accent }} />
        {title}
      </p>

      <div className="flex flex-col gap-3">
        {tracks
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((track) => {
            const isPlaying = playingId === track.id;
            // A protected track (real purchase item, see TrackRow/the
            // Buy Now storefront) always routes its Buy CTA to the real
            // checkout instead of the old buy_url/WhatsApp hand-off —
            // that old flow had no way to actually deliver a purchased
            // file, this one does.
            const isProtected = !!track.protected_audio_path;
            const canBuy = isProtected ? !!track.price : track.buy_url || track.price;
            return (
              <div
                key={track.id}
                className="relative overflow-hidden rounded-2xl p-3 flex items-center gap-3"
                style={{ backgroundColor: CARD_BG, color: CARD_TEXT }}
              >
                {track.cover_image_url ? (
                  <img src={track.cover_image_url} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />
                ) : (
                  <div
                    className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: hexToRgba(accent, 0.18) }}
                  >
                    <Music size={20} style={{ color: accent }} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                    {track.title}
                    {isPlaying && <EqualizerBars color={accent} />}
                  </p>
                  <p className="text-xs truncate flex items-center gap-1" style={{ opacity: 0.6 }}>
                    {track.artist_name || artistName}
                    {track.duration ? ` · ${track.duration}` : ""}
                    {isProtected && (
                      <span className="inline-flex items-center gap-0.5 shrink-0">
                        <Lock size={9} />
                        {t.music.previewButtonLabel}
                      </span>
                    )}
                  </p>
                  {/* Real playback position when this is the playing track — not
                      a decorative static bar. Sits empty (0%) otherwise. */}
                  <div className="h-1 rounded-full mt-2 overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}>
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{ width: `${isPlaying ? Math.round(progress * 100) : 0}%`, backgroundColor: accent }}
                    />
                  </div>
                </div>

                {(isProtected ? track.preview_audio_url : track.audio_url || track.external_url) && (
                  <button
                    onClick={() => onTogglePlay(track)}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition active:scale-90 shadow-md"
                    style={{ backgroundColor: accent, color: "#171009" }}
                  >
                    {(isProtected ? track.preview_audio_url : track.audio_url) ? (
                      isPlaying ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />
                    ) : (
                      <ExternalLink size={15} />
                    )}
                  </button>
                )}

                {canBuy &&
                  (isProtected ? (
                    <a
                      href={`/m/${username}`}
                      className="shrink-0 text-xs font-semibold px-3 py-2 rounded-full"
                      style={{ backgroundColor: accent, color: "#171009" }}
                    >
                      {track.price ? formatPrice(track.price, currency) : t.music.buyLabel}
                    </a>
                  ) : track.buy_url ? (
                    <a
                      href={track.buy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs font-semibold px-3 py-2 rounded-full"
                      style={{ backgroundColor: accent, color: "#171009" }}
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
