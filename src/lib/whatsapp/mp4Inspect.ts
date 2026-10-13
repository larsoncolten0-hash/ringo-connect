// A small, dependency-free reader of the MP4 / 3GPP container (ISO base media file format), used to enforce WhatsApp's stricter video requirements BEFORE a file is sent:
//   "Only H.264 video codec and AAC audio codec supported. Single audio stream or no audio stream only."   (Meta, WhatsApp Cloud API, Video messages / Media)
// The container's own header says which codecs are inside, so a HEVC / VP9 / AV1 / H.263 video, or an AMR / MP3 / Opus soundtrack, is refused here with a clear reason instead of
// failing at Meta. Pure: no Node APIs, no network. The browser uses it for an early check on a File (inspectMp4Blob); the server runs the SAME rules on the bytes it received.
//
// NOT enforced (documented): the H.264 *profile* (Meta recommends Baseline or Main without B-frames; High profile / B-frames are "not supported by Android WhatsApp clients" but
// the API still accepts them). They are reported as `notes` so they can be shown, never as a refusal, because refusing every High-profile phone video would block most phones.

export type Mp4Reason = "unreadable" | "no_video" | "video_codec" | "audio_codec" | "audio_streams";
export type Mp4Result = { ok: true; video: string[]; audio: string[]; notes: ("high_profile" | "b_frames")[] } | { ok: false; reason: Mp4Reason; video?: string[]; audio?: string[] };

const H264 = new Set(["avc1", "avc3"]);
// MPEG-4 Audio object type indications that are AAC (0x40 = MPEG-4 AAC, 0x66-0x68 = MPEG-2 AAC profiles). 0x69 / 0x6b are MP3, 0xa5 / 0xe1 AC-3 / QCELP: refused.
const AAC_OTI = new Set([0x40, 0x66, 0x67, 0x68]);
const MAX_DEPTH = 8;

const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const fourcc = (b: Uint8Array, o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

interface Box { type: string; start: number; body: number; end: number }

/** The boxes directly inside [from, to). Stops (never throws) at anything that does not fit. */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > to) break;
      // 64-bit size: anything above 2^32 cannot exist in a 16 MB file; treat the high word as "to the end"
      const hi = u32(b, o + 8);
      size = hi > 0 ? to - o : u32(b, o + 12);
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header || o + size > to) break;
    out.push({ type, start: o, body: o + header, end: o + size });
    o += size;
  }
  return out;
}
const child = (b: Uint8Array, parent: Box, type: string): Box | undefined => boxes(b, parent.body, parent.end).find((x) => x.type === type);

/** The audio object type of an `mp4a` sample entry, read from its `esds` descriptor. null = could not be read. */
function aacObjectType(b: Uint8Array, entry: Box): number | null {
  // the esds box sits inside the entry after a fixed audio header (28 bytes, +16 / +36 for the older "version 1/2" layouts): search for it
  for (let o = entry.body; o + 8 <= entry.end; o++) {
    if (b[o + 4] !== 0x65 || b[o + 5] !== 0x73 || b[o + 6] !== 0x64 || b[o + 7] !== 0x73) continue; // "esds"
    const size = u32(b, o);
    if (size < 12 || o + size > entry.end) continue;
    let p = o + 8 + 4; // box header + version/flags
    const end = o + size;
    const readLen = (): number | null => {
      let len = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const c = b[p++];
        len = (len << 7) | (c & 0x7f);
        if (!(c & 0x80)) return len;
      }
      return null;
    };
    if (b[p++] !== 0x03) return null; // ES_Descriptor
    if (readLen() === null) return null;
    p += 2; // ES_ID
    const flags = b[p++];
    if (flags & 0x80) p += 2;
    if (flags & 0x40) p += 1 + b[p];
    if (flags & 0x20) p += 2;
    if (p >= end || b[p++] !== 0x04) return null; // DecoderConfigDescriptor
    if (readLen() === null || p >= end) return null;
    return b[p];
  }
  return null;
}

/** The H.264 profile (profile_idc) of an `avc1` / `avc3` sample entry, read from its `avcC` box. null = could not be read. */
function avcProfile(b: Uint8Array, entry: Box): number | null {
  for (let o = entry.body; o + 13 <= entry.end; o++) {
    if (b[o + 4] === 0x61 && b[o + 5] === 0x76 && b[o + 6] === 0x63 && b[o + 7] === 0x43) return b[o + 8 + 1]; // "avcC": configurationVersion, then AVCProfileIndication
  }
  return null;
}

/** Inspects a complete MP4 / 3GPP file (or at least its `moov` box). */
export function inspectMp4(bytes: Uint8Array): Mp4Result {
  try {
    if (!bytes || bytes.length < 16) return { ok: false, reason: "unreadable" };
    const top = boxes(bytes, 0, bytes.length);
    const moov = top.find((x) => x.type === "moov");
    if (!moov) return { ok: false, reason: "unreadable" };
    const video: string[] = [];
    const audio: string[] = [];
    const notes: ("high_profile" | "b_frames")[] = [];
    let audioBad = false;
    for (const trak of boxes(bytes, moov.body, moov.end).filter((x) => x.type === "trak")) {
      const mdia = child(bytes, trak, "mdia");
      const hdlr = mdia && child(bytes, mdia, "hdlr");
      if (!mdia || !hdlr || hdlr.body + 12 > hdlr.end) continue;
      const handler = fourcc(bytes, hdlr.body + 8); // version/flags (4), pre_defined (4), then the handler type
      if (handler !== "vide" && handler !== "soun") continue; // timecode, text, hint and metadata tracks are not streams a viewer sees
      const minf = child(bytes, mdia, "minf");
      const stbl = minf && child(bytes, minf, "stbl");
      const stsd = stbl && child(bytes, stbl, "stsd");
      if (!stbl || !stsd || stsd.body + 8 > stsd.end) return { ok: false, reason: "unreadable" };
      const entry = boxes(bytes, stsd.body + 8, stsd.end)[0]; // version/flags (4) + entry_count (4), then the sample entries
      if (!entry) return { ok: false, reason: "unreadable" };
      if (handler === "vide") {
        video.push(entry.type);
        if (H264.has(entry.type)) {
          const profile = avcProfile(bytes, entry);
          if (profile !== null && profile >= 100 && !notes.includes("high_profile")) notes.push("high_profile");
          if (child(bytes, stbl, "ctts") && !notes.includes("b_frames")) notes.push("b_frames");
        }
      } else {
        audio.push(entry.type);
        if (entry.type !== "mp4a") audioBad = true;
        else {
          const oti = aacObjectType(bytes, entry);
          if (oti === null || !AAC_OTI.has(oti)) audioBad = true;
        }
      }
    }
    if (video.length === 0) return { ok: false, reason: "no_video", video, audio };
    if (!video.every((v) => H264.has(v))) return { ok: false, reason: "video_codec", video, audio };
    if (audio.length > 1) return { ok: false, reason: "audio_streams", video, audio };
    if (audioBad) return { ok: false, reason: "audio_codec", video, audio };
    return { ok: true, video, audio, notes };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * The same inspection for a File / Blob in the browser WITHOUT loading it all: only the top-level box headers are read, then the `moov` box (the index, normally well under a
 * megabyte). Returns null when nothing could be read (the server is then the judge).
 */
export async function inspectMp4Blob(blob: Blob): Promise<Mp4Result | null> {
  try {
    let offset = 0;
    const total = blob.size;
    for (let i = 0; i < 64 && offset + 8 <= total; i++) {
      const head = new Uint8Array(await blob.slice(offset, Math.min(total, offset + 16)).arrayBuffer());
      if (head.length < 8) return null;
      let size = u32(head, 0);
      const type = fourcc(head, 4);
      let header = 8;
      if (size === 1) {
        if (head.length < 16) return null;
        size = u32(head, 8) > 0 ? total - offset : u32(head, 12);
        header = 16;
      } else if (size === 0) size = total - offset;
      if (size < header) return null;
      if (type === "moov") {
        if (size > 8 * 1024 * 1024) return null; // an index this large is not worth reading in a browser; the server decides
        const moov = new Uint8Array(await blob.slice(offset, Math.min(total, offset + size)).arrayBuffer());
        return inspectMp4(moov);
      }
      offset += size;
    }
    return null;
  } catch {
    return null;
  }
}
