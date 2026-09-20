// Where a catalog item's detail page lives. Music & Entertainment profiles
// keep their existing route (/m/[username]/merch/[id], which also hands off
// to the storefront's checkout); every other category gets the same premium
// detail page at /[username]/item/[id].
export function productHref(username: string, productId: string, isMusic: boolean): string {
  return isMusic ? `/m/${username}/merch/${productId}` : `/${username}/item/${productId}`;
}

// All of an item's photos in display order — image_urls (multi-photo) wins,
// falling back to the original single image_url. Never returns blanks.
export function productImages(product: { image_urls?: string[] | null; image_url?: string | null }): string[] {
  const list = product.image_urls?.length ? product.image_urls : [product.image_url];
  return list.filter((u): u is string => !!u);
}
