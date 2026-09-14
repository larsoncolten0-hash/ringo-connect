-- Fan-facing profile PWA branding (additive) — proper icon derivatives for
-- /[username]/manifest.webmanifest, generated once at avatar-upload time
-- (see /api/profile/avatar-icons) rather than a raw pass-through of the
-- original avatar file at every manifest request. All three nullable:
-- a profile with no avatar, or one uploaded before this feature existed,
-- simply falls back to the original avatar_url / the platform's generic
-- icons, exactly as the manifest route already did before this migration.
alter table profiles add column if not exists avatar_icon_192_url text;
alter table profiles add column if not exists avatar_icon_512_url text;
-- Padded onto a plain white safe-zone background (not the profile's own
-- theme_color/background_color) so the avatar photo itself stays legible
-- regardless of Android's mask shape — same reasoning
-- scripts/generate-pwa-icons.js already uses for the platform's own
-- Apple touch icon fallback.
alter table profiles add column if not exists avatar_icon_maskable_512_url text;
