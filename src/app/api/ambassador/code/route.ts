import { createClient, createAdminClient } from "@/lib/supabase/server";
import { changeMySalesCode } from "@/lib/ambassador/codeEdit";
import { NextResponse } from "next/server";

// An Ambassador / Team Leader changes their OWN code (see src/lib/ambassador/codeEdit.ts).
// The person is the signed-in session user; the body contributes only the new code.
// Responses carry stable codes; the client renders the bilingual text.
const STATUS: Record<string, number> = { invalid_code: 400, taken: 409, not_ambassador: 403, not_active: 403, unavailable: 500 };

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = await changeMySalesCode(createAdminClient(), user.id, body?.code);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: STATUS[result.code] ?? 400 });
  return NextResponse.json({ ok: true, code: result.code });
}
