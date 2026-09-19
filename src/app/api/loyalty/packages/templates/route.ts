import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getLoyaltyOptions } from "@/lib/loyalty/categories";
import { invalidRequest, jsonError, readJsonObject } from "@/lib/loyalty/http";
import { createTemplate, listTemplates, parseTemplateCreate } from "@/lib/loyalty/templates";

// Package templates (what the business sells). Only for categories that offer packages, and
// only with actions that category allows.
export async function GET(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;
  return NextResponse.json({ templates: await listTemplates(access.profile.id, access.admin) });
}

export async function POST(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const parsed = parseTemplateCreate(body, getLoyaltyOptions(access.profile));
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const created = await createTemplate(access.profile.id, access.userId, access.profile.currency, parsed.value, access.admin);
  if (!created.ok) return jsonError(created.error, 500);
  return NextResponse.json({ template: created.template }, { status: 201 });
}
