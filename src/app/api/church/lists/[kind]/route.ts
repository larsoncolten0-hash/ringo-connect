import { NextResponse } from "next/server";
import { resolveChurchActor } from "@/lib/church/actor";
import { buildChurchList } from "@/lib/church/lists/build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/church/lists/members | leadership | groups?lang=en|fr: the list as a PDF download. Needs the export permission (church.export, owner-only to grant) AND the permission to see that list. The church
// and the permissions are resolved on the server from the session; the response is never cached and carries no person in its name. Only the language is read from the query.
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: { kind: string } }) {
  const resolved = await resolveChurchActor();
  if (!resolved.ok) return resolved.reason === "not_signed_in" ? json({ ok: false, error: "not_signed_in" }, 401) : json({ ok: false, error: "forbidden" }, 403);
  let query: URLSearchParams;
  try {
    query = new URL(request.url).searchParams;
  } catch {
    query = new URLSearchParams();
  }
  for (const k of Array.from(query.keys())) if (k !== "lang") return json({ ok: false, error: "unexpected_field", field: k }, 400);
  try {
    const result = await buildChurchList(resolved.actor, params.kind, query.get("lang") || "en");
    if (!result.ok) return json({ ok: false, error: result.code }, result.status);
    // one line per list, never a person: how many rows went out
    console.info(JSON.stringify({ scope: "church_lists", kind: params.kind, rows: result.rows }));
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    console.error(JSON.stringify({ scope: "church_lists", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}
