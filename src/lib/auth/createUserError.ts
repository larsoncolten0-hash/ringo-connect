// Did `auth.admin.createUser` fail because an auth user with that email already exists? Used by the admin
// "approve request" route to answer with a clear 409 instead of a generic 500. Matches Supabase's stable error code
// first and its message as a fallback; anything else (including a taken username raised by the signup trigger) is
// NOT an email conflict.

export function isEmailExistsError(err: { message?: string | null; code?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "email_exists") return true;
  return /already (been )?registered|email address.*already|already exists/i.test(err.message ?? "") && !/username/i.test(err.message ?? "");
}

export const EMAIL_EXISTS_MESSAGE =
  "An account with this email already exists (for example from an earlier Google or Apple sign-in attempt). Nothing was created and this request is still pending: check for the existing account, then approve again.";
