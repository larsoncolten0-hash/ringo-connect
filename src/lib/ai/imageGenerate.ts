import { createAdminClient } from "@/lib/supabase/server";
import { AiProviderError } from "@/lib/ai/providers/types";
import { generateOpenAiImage } from "@/lib/ai/providers/openai";
import type { AiAccess } from "@/lib/ai/guard";
import { reserveAiImageQuota, releaseAiImageQuota, type AiImageLimitReason } from "@/lib/ai/imageGuard";
import { estimateImageCostUsd, estimateImageReservationCost, recordImageUsageEvent, EMPTY_IMAGE_USAGE, type AiImageUsage } from "@/lib/ai/imageUsage";
import { aiGeneratedImagePath } from "@/lib/ai/uploads";

// The one place that actually generates + stores + accounts for a Ringo AI
// image, shared by BOTH the generate_image tool (src/lib/ai/tools/definitions/image.ts,
// called mid-conversation by the model) and POST /api/ai/images/generate
// (src/app/api/ai/images/generate/route.ts, a direct REST call) — so the
// reservation/generation/storage/accounting sequence exists in exactly one
// place, never duplicated or able to drift between the two callers.
//
// Callers are responsible for resolving access first (resolveAiImageAccess)
// — this function only does the generation itself, assuming an already
// -eligible `access`. It never trusts a model/client-supplied size, quality
// or model id; those always come from access.settings (admin-configured).

const extFromContentType = (contentType: string): string => {
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/jpeg") return "jpg";
  return "png";
};

export type GenerateAndStoreImageReason = AiImageLimitReason | "generation_failed" | "storage_failed";

export type GenerateAndStoreImageResult =
  | { ok: true; imageUrl: string; storagePath: string; model: string; size: string; quality: string }
  | { ok: false; reason: GenerateAndStoreImageReason };

export async function generateAndStoreImage(access: AiAccess, prompt: string, conversationId: string | null): Promise<GenerateAndStoreImageResult> {
  const { settings, workspace } = access;
  const model = settings.imageModel;
  const size = settings.imageDefaultSize;
  const quality = settings.imageDefaultQuality;

  // Estimate for the budget reservation only — real, historical average
  // cost for this exact model/size/quality, never an invented number (see
  // imageUsage.ts). Null just means the budget isn't enforced for THIS one
  // reservation (e.g. no history yet); the daily/monthly count limits are
  // exact and always enforced regardless.
  const estimatedCost = await estimateImageReservationCost(model, size, quality);
  const reservation = await reserveAiImageQuota(access, estimatedCost);
  if (!reservation.ok) return { ok: false, reason: reservation.reason };

  const recordAndRelease = async (status: "ok" | "error", errorCode: string | null, usage: AiImageUsage, storagePath: string | null, providerRequestId: string | null) => {
    const costUsd = estimateImageCostUsd(usage, settings);
    await recordImageUsageEvent({
      userId: workspace.userId,
      profileId: workspace.profileId,
      conversationId,
      model,
      size,
      quality,
      status,
      errorCode,
      usage,
      costUsd,
      storagePath,
      providerRequestId,
    });
    await releaseAiImageQuota(reservation.reservationId);
  };

  let result;
  try {
    result = await generateOpenAiImage({ model, prompt, size, quality });
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : "unknown";
    console.error("generateAndStoreImage provider call failed:", error instanceof Error ? error.message : error);
    await recordAndRelease("error", code, EMPTY_IMAGE_USAGE, null, null);
    return { ok: false, reason: "generation_failed" };
  }

  const usage = result.usage ?? EMPTY_IMAGE_USAGE;
  const path = aiGeneratedImagePath(workspace.userId, extFromContentType(result.contentType));
  const storage = createAdminClient();
  const { error: uploadError } = await storage.storage.from("uploads").upload(path, result.bytes, {
    upsert: false,
    cacheControl: "3600",
    contentType: result.contentType,
  });
  if (uploadError) {
    console.error("generateAndStoreImage storage upload failed:", uploadError.message);
    await recordAndRelease("error", "storage_failed", usage, null, result.providerRequestId);
    return { ok: false, reason: "storage_failed" };
  }

  const { data: publicUrlData } = storage.storage.from("uploads").getPublicUrl(path);
  await recordAndRelease("ok", null, usage, path, result.providerRequestId);

  return { ok: true, imageUrl: publicUrlData.publicUrl, storagePath: path, model: result.model, size: result.size, quality: result.quality };
}
