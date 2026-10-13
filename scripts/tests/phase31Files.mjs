// The EXACT files the image display fix changes or adds: link icons and product / merch photos are shown whole and at a fixed size (object-contain on a tinted ground, intrinsic
// width/height, no hover zoom), and the editor previews match the public pages. Display only: no storage, upload, auth, payment, database or API change.
// Same convention as phase28Files.mjs / phase30Files.mjs: explicit, no wildcards, no directories.
export const PHASE31_FILES = new Set([
  "scripts/tests/phase31Files.mjs",
  "scripts/tests/imageFit.test.mjs",
  "src/components/ProfileView.tsx",
  "src/components/music/profile/MusicSections.tsx",
  "src/components/catalog/CatalogSection.tsx",
  "src/components/catalog/ProductDetailView.tsx",
  "src/components/shop/ShopDestination.tsx",
  "src/components/music/MusicStorePage.tsx",
  "src/components/editor/ImageUploadField.tsx",
  "src/components/editor/LinkRow.tsx",
  "src/components/editor/ProductRow.tsx",
  "src/components/editor/ImageGalleryUploadField.tsx",
]);
