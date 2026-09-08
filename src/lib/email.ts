// Transactional email via Resend's HTTP API — no SDK dependency, same
// plain-fetch style as src/lib/fapshi.ts. Deliberately silent-fails: every
// caller (signup submission, request approval) treats email as a
// best-effort side effect, never something whose failure should break the
// actual signup/approval it's reporting on. Configure by setting
// RESEND_API_KEY (and optionally RESEND_FROM_EMAIL) — see .env.example.
const RESEND_API_URL = "https://api.resend.com/emails";

export async function sendEmail(params: { to: string | string[]; subject: string; html: string }) {
  const to = Array.isArray(params.to) ? params.to.filter(Boolean) : params.to;
  if (!to || (Array.isArray(to) && to.length === 0)) return { sent: false };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Not configured — expected in local dev before an admin sets it up.
    // Logging (not throwing) keeps every call site simple: fire-and-await
    // without a try/catch of its own.
    console.warn(`sendEmail: RESEND_API_KEY not set — skipping "${params.subject}" to`, to);
    return { sent: false };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "Ringo Connect <onboarding@resend.dev>",
        to,
        subject: params.subject,
        html: params.html,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("sendEmail failed:", res.status, data?.message || data);
      return { sent: false };
    }
    return { sent: true };
  } catch (err: any) {
    console.error("sendEmail threw:", err?.message || err);
    return { sent: false };
  }
}

// Shared wrapper so every transactional email looks like it's from the
// same product rather than a bare unstyled paragraph.
export function emailShell(bodyHtml: string) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
      <p style="font-weight: 600; font-size: 16px; letter-spacing: -0.01em; margin: 0 0 24px;">Ringo Connect</p>
      ${bodyHtml}
      <p style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
        Ringo Connect — link-in-bio &amp; social commerce.
      </p>
    </div>
  `;
}
