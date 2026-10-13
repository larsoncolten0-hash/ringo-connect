// Test helper (NOT a test file): builds small, structurally valid MP4 / 3GPP containers with a chosen set of codecs, so the codec rules (H.264 video, AAC audio, one audio stream)
// can be tested on real box structures: ftyp, then moov (trak > mdia > hdlr + minf > stbl > stsd > a sample entry [+ avcC / esds]), then mdat. No real media is encoded.
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const flat = (parts) => parts.flat(Infinity);
const box = (type, ...payload) => { const body = flat(payload); return [...u32(8 + body.length), ...ascii(type), ...body]; };
const fullbox = (type, ...payload) => box(type, [0, 0, 0, 0], ...payload);
const zeros = (n) => new Array(n).fill(0);

const hdlr = (handler) => fullbox("hdlr", u32(0), ascii(handler), zeros(12), [0]);
const avcC = (profile) => box("avcC", [1, profile, 0, 30, 0xff, 0xe1, 0, 0, 0]);
// visual sample entry: 6 reserved + data ref index + 70 bytes of picture fields = 78 bytes, then its child boxes
const visualEntry = (fourcc, profile) => box(fourcc, zeros(6), [0, 1], zeros(70), /^avc/.test(fourcc) ? avcC(profile) : []);
// MPEG-4 elementary stream descriptor with the given object type (0x40 = AAC, 0x6b = MP3)
const esds = (oti) => {
  const dec = [oti, 0x15, 0, 0, 0, ...u32(0), ...u32(0), 0x05, 2, 0x12, 0x10]; // DecoderConfigDescriptor payload (13) + DecoderSpecificInfo (4)
  const es = [0, 0, 0, 0x04, dec.length, ...dec, 0x06, 1, 2]; // ES_ID (2), flags (1), the decoder config, the SL config
  return fullbox("esds", [0x03, es.length, ...es]);
};
const audioEntry = (fourcc, oti) => box(fourcc, zeros(6), [0, 1], zeros(8), [0, 2, 0, 16, 0, 0, 0, 0, 0xbb, 0x80, 0, 0], fourcc === "mp4a" ? esds(oti) : []);
const trak = (handler, entry, { ctts = false } = {}) => box("trak", box("mdia", hdlr(handler), box("minf", box("stbl", fullbox("stsd", u32(1), entry), ctts ? fullbox("ctts", u32(0)) : []))));

/**
 * options: brand ("isom" = MP4, "3gp4" = 3GPP), video: fourccs of the video tracks, audio: fourccs of the audio tracks, profile (H.264 profile_idc: 66 baseline, 77 main, 100 high),
 * oti (AAC = 0x40), ctts (a composition-offset box = B-frames), moovLast (the index after the media data, i.e. not "faststart"), mdatBytes (size of the media data), noMoov, extraTrack.
 */
export function mp4Bytes({ brand = "isom", video = ["avc1"], audio = ["mp4a"], profile = 66, oti = 0x40, ctts = false, moovLast = false, mdatBytes = 4, noMoov = false, extraTrack = false } = {}) {
  const ftyp = box("ftyp", ascii(brand), u32(0), ascii(brand));
  const tracks = [
    ...video.map((f) => trak("vide", visualEntry(f, profile), { ctts })),
    ...audio.map((f) => trak("soun", audioEntry(f, oti))),
    ...(extraTrack ? [trak("tmcd", box("tmcd", zeros(8)))] : []),
  ];
  const moov = noMoov ? [] : box("moov", fullbox("mvhd", zeros(96)), tracks);
  const mdat = box("mdat", zeros(mdatBytes));
  return Uint8Array.from(moovLast ? [...ftyp, ...mdat, ...moov] : [...ftyp, ...moov, ...mdat]);
}
