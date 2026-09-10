// Client-side preview-clip trimming for protected tracks (see
// ProtectedAudioUploadField.tsx, the only caller). An artist selling a
// track as a real purchase uploads exactly one audio file — the full file
// goes into the private protected-audio bucket and is never made public.
// The moment that upload finishes, we also decode that same file (still
// sitting in the browser as a local File, no extra download needed),
// slice out the first MAX_PREVIEW_SECONDS, and re-encode just that slice
// as a small public MP3 — the only thing that ever becomes public. No
// artist interaction (no manual start/end marking) is needed.
import lamejs from "lamejs";

export const MAX_PREVIEW_SECONDS = 30;

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

// Fully decodes a local audio File/Blob into raw PCM — there's no
// partial-decode API in the browser, so this reads the whole file even
// though only its first MAX_PREVIEW_SECONDS end up in the final clip.
export async function decodeAudioFile(file: File | Blob): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextCtor: typeof AudioContext =
    window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

// Slices [0, MAX_PREVIEW_SECONDS) (or the whole thing, if shorter) out of
// `buffer` and re-encodes it as a small 128kbps MP3 Blob.
export function trimToPreviewMp3(buffer: AudioBuffer): Blob {
  const sampleRate = buffer.sampleRate;
  const endSample = Math.min(buffer.length, Math.floor(MAX_PREVIEW_SECONDS * sampleRate));
  const channels = Math.min(2, buffer.numberOfChannels);

  const left = floatTo16BitPCM(buffer.getChannelData(0).subarray(0, endSample));
  const right = channels > 1 ? floatTo16BitPCM(buffer.getChannelData(1).subarray(0, endSample)) : null;

  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
  const blockSize = 1152;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const mp3buf: Uint8Array = right
      ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
      : encoder.encodeBuffer(leftChunk);
    if (mp3buf.length > 0) chunks.push(mp3buf);
  }
  const tail: Uint8Array = encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}
