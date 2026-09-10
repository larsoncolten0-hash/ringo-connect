// Client-side preview-clip trimming for protected tracks (see
// PreviewTrimField.tsx, the only caller). An artist selling a track as a
// real purchase uploads exactly one audio file, into the private
// protected-audio bucket (see ProtectedAudioUploadField) — the full file
// is never made public. To give fans a short preview without ever
// exposing that file, we decode it in the ARTIST's own browser (using a
// short-lived signed URL they already have owner access to), slice out
// just the window they picked, and re-encode that slice as a small public
// MP3 — the only thing that ever becomes publicly reachable.
import lamejs from "lamejs";

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

// Downloads and fully decodes `url` into raw PCM. Runs once per trim —
// there's no partial-decode API in the browser, so this reads the whole
// file even though only a slice of it will end up in the final clip.
export async function fetchAndDecodeAudio(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download audio for trimming.");
  const arrayBuffer = await res.arrayBuffer();
  const AudioContextCtor: typeof AudioContext =
    window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

// Slices [startSeconds, endSeconds) out of `buffer` and re-encodes just
// that slice as a small 128kbps MP3 Blob — the file that actually gets
// uploaded as the public preview.
export function trimToMp3(buffer: AudioBuffer, startSeconds: number, endSeconds: number): Blob {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSeconds * sampleRate));
  const endSample = Math.min(buffer.length, Math.floor(endSeconds * sampleRate));
  const channels = Math.min(2, buffer.numberOfChannels);

  const left = floatTo16BitPCM(buffer.getChannelData(0).subarray(startSample, endSample));
  const right = channels > 1 ? floatTo16BitPCM(buffer.getChannelData(1).subarray(startSample, endSample)) : null;

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
