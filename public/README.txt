Static assets go here — anything in this folder is served from the site root.

Drop in:
- logo.png            → referenced on the landing page (src/app/page.tsx) and in metadata
- default-avatar.png  → fallback avatar used in ProfileView.tsx when a creator hasn't uploaded one
- favicon.ico         → browser tab icon (Next.js picks this up automatically if placed here)

Example: public/logo.png becomes accessible at /logo.png in the app,
e.g. <img src="/logo.png" />.
