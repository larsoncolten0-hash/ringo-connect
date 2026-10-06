import { CATEGORIES } from "@/lib/categories";

// Visual QA fixtures for /dev-preview-profile: a complete, realistic profile for any category, built in memory. Nothing is read from or
// written to the database, and every image is an inline SVG, so a reviewer sees the page's real composition offline. English and French
// profile copy come from the same table so both languages can be inspected at every width.

const art = (a: string, b: string, kind: "photo" | "logo" | "face" = "photo") => {
  const shapes =
    kind === "face"
      ? `<circle cx="200" cy="165" r="62" fill="rgba(255,255,255,.55)"/><ellipse cx="200" cy="360" rx="130" ry="120" fill="rgba(255,255,255,.55)"/>`
      : kind === "logo"
        ? `<rect x="110" y="110" width="180" height="180" rx="36" fill="rgba(255,255,255,.6)"/><circle cx="200" cy="200" r="44" fill="${b}"/>`
        : `<circle cx="300" cy="120" r="90" fill="rgba(255,255,255,.28)"/><path d="M0 300 Q120 190 240 270 T400 230 V400 H0Z" fill="rgba(0,0,0,.22)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/>${shapes}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

type L = { en: string; fr: string };
interface Seed {
  name: L;
  bio: L;
  place: string;
  offer: L; // the catalogue's items
  items: { n: L; price: number; c: [string, string] }[];
  cover: [string, string];
  subcategory?: string;
}

const SEEDS: Record<string, Seed> = {
  music_entertainment: { name: { en: "Jay Kay", fr: "Jay Kay" }, bio: { en: "Afrobeat artist from Douala.", fr: "Artiste afrobeat de Douala." }, place: "Douala", offer: { en: "Merch", fr: "Merch" }, cover: ["#3B1F5C", "#0A0A0A"], items: [{ n: { en: "Tour hoodie", fr: "Sweat de tournée" }, price: 12000, c: ["#7C3AED", "#1E1B4B"] }, { n: { en: "Cap", fr: "Casquette" }, price: 5000, c: ["#F59E0B", "#7C2D12"] }] },
  business_ecommerce: { name: { en: "Mbeki Fashion House", fr: "Maison de Mode Mbeki" }, bio: { en: "Ready-to-wear and made-to-measure, delivered across Cameroon.", fr: "Prêt-à-porter et sur mesure, livré partout au Cameroun." }, place: "Yaoundé", offer: { en: "Shop", fr: "Boutique" }, cover: ["#0F3D3E", "#0A0A0A"], items: [{ n: { en: "Ankara dress", fr: "Robe en ankara" }, price: 18000, c: ["#F97316", "#7C2D12"] }, { n: { en: "Linen shirt", fr: "Chemise en lin" }, price: 12500, c: ["#38BDF8", "#0C4A6E"] }, { n: { en: "Leather bag", fr: "Sac en cuir" }, price: 32000, c: ["#A16207", "#451A03"] }] },
  restaurant_food: { name: { en: "Chez Mama Ngozi", fr: "Chez Mama Ngozi" }, bio: { en: "Home cooking, grilled fish and ndolé. Open every day.", fr: "Cuisine maison, poisson braisé et ndolé. Ouvert tous les jours." }, place: "Bonapriso, Douala", offer: { en: "Menu", fr: "Menu" }, cover: ["#9A3412", "#1C0A04"], items: [{ n: { en: "Ndolé & plantain", fr: "Ndolé et plantain" }, price: 3500, c: ["#65A30D", "#1A2E05"] }, { n: { en: "Grilled fish", fr: "Poisson braisé" }, price: 4500, c: ["#EA580C", "#431407"] }, { n: { en: "Poulet DG", fr: "Poulet DG" }, price: 5000, c: ["#CA8A04", "#422006"] }] },
  real_estate: { name: { en: "Atlas Properties", fr: "Atlas Immobilier" }, bio: { en: "Homes and land in Douala, verified and ready to visit.", fr: "Maisons et terrains à Douala, vérifiés et visitables." }, place: "Douala", offer: { en: "Listings", fr: "Annonces" }, cover: ["#1E3A5F", "#0A0A0A"], items: [{ n: { en: "3-bedroom villa", fr: "Villa 3 chambres" }, price: 85000000, c: ["#0EA5E9", "#0C4A6E"] }, { n: { en: "Building plot, 500 m²", fr: "Terrain de 500 m²" }, price: 15000000, c: ["#84CC16", "#365314"] }] },
  transport_logistics: { name: { en: "Rapide Express", fr: "Rapide Express" }, bio: { en: "Same-day delivery and intercity freight.", fr: "Livraison le jour même et fret interurbain." }, place: "Douala", offer: { en: "Routes", fr: "Trajets" }, cover: ["#1F2937", "#0A0A0A"], items: [{ n: { en: "Douala → Yaoundé", fr: "Douala → Yaoundé" }, price: 4500, c: ["#38BDF8", "#075985"] }, { n: { en: "Parcel pickup", fr: "Collecte de colis" }, price: 2000, c: ["#F59E0B", "#78350F"] }] },
  professional_services: { name: { en: "Dr. Nkemelu & Partners", fr: "Cabinet Nkemelu & Associés" }, bio: { en: "Legal advice for small businesses and families.", fr: "Conseil juridique pour petites entreprises et familles." }, place: "Akwa, Douala", offer: { en: "Services", fr: "Services" }, cover: ["#312E81", "#0A0A0A"], items: [{ n: { en: "Company registration", fr: "Création d'entreprise" }, price: 150000, c: ["#6366F1", "#1E1B4B"] }, { n: { en: "Contract review", fr: "Relecture de contrat" }, price: 50000, c: ["#14B8A6", "#134E4A"] }] },
  beauty_wellness: { name: { en: "Sana Beauty Studio", fr: "Sana Beauty Studio" }, bio: { en: "Braids, makeup and skin care by appointment.", fr: "Tresses, maquillage et soins sur rendez-vous." }, place: "Bastos, Yaoundé", offer: { en: "Services", fr: "Services" }, cover: ["#831843", "#1A0A12"], items: [{ n: { en: "Knotless braids", fr: "Tresses sans nœuds" }, price: 25000, c: ["#EC4899", "#500724"] }, { n: { en: "Facial treatment", fr: "Soin du visage" }, price: 15000, c: ["#FDBA74", "#7C2D12"] }] },
  health_medical: { name: { en: "Clinique Espoir", fr: "Clinique Espoir" }, bio: { en: "Family medicine and consultations, open 7 days.", fr: "Médecine générale et consultations, 7 jours sur 7." }, place: "Douala", offer: { en: "Services", fr: "Services" }, cover: ["#064E3B", "#0A0A0A"], items: [{ n: { en: "General consultation", fr: "Consultation générale" }, price: 10000, c: ["#10B981", "#064E3B"] }, { n: { en: "Lab tests", fr: "Analyses" }, price: 8000, c: ["#38BDF8", "#075985"] }] },
  education_training: { name: { en: "Bright Minds Academy", fr: "Académie Bright Minds" }, bio: { en: "Coding and English classes for teens and adults.", fr: "Cours de programmation et d'anglais pour ados et adultes." }, place: "Buea", offer: { en: "Courses", fr: "Cours" }, cover: ["#1E40AF", "#0A0A0A"], items: [{ n: { en: "Web development", fr: "Développement web" }, price: 60000, c: ["#3B82F6", "#1E3A8A"] }, { n: { en: "Spoken English", fr: "Anglais courant" }, price: 25000, c: ["#F59E0B", "#78350F"] }] },
  travel_hospitality: { name: { en: "Kribi Beach Lodge", fr: "Kribi Beach Lodge" }, bio: { en: "Seaside rooms, boat trips and beach dinners.", fr: "Chambres en bord de mer, sorties en bateau et dîners sur la plage." }, place: "Kribi", offer: { en: "Rooms", fr: "Chambres" }, cover: ["#0C4A6E", "#0A0A0A"], items: [{ n: { en: "Ocean-view room", fr: "Chambre vue mer" }, price: 45000, c: ["#0EA5E9", "#0C4A6E"] }, { n: { en: "Boat trip", fr: "Sortie en bateau" }, price: 20000, c: ["#14B8A6", "#134E4A"] }] },
  events_experiences: { name: { en: "Douala Night Market", fr: "Marché de Nuit de Douala" }, bio: { en: "Street food, live music and craft stalls, monthly.", fr: "Street food, musique live et artisanat, chaque mois." }, place: "Douala", offer: { en: "Experiences", fr: "Expériences" }, cover: ["#7C2D12", "#0A0A0A"], items: [{ n: { en: "VIP table", fr: "Table VIP" }, price: 50000, c: ["#F43F5E", "#4C0519"] }] },
  creative_media: { name: { en: "Studio Kamga", fr: "Studio Kamga" }, bio: { en: "Photo, video and brand films.", fr: "Photo, vidéo et films de marque." }, place: "Douala", offer: { en: "Portfolio", fr: "Portfolio" }, cover: ["#4A044E", "#0A0A0A"], items: [{ n: { en: "Brand film", fr: "Film de marque" }, price: 400000, c: ["#A855F7", "#3B0764"] }, { n: { en: "Portrait session", fr: "Séance portrait" }, price: 35000, c: ["#F97316", "#7C2D12"] }] },
  freelancers_creators: { name: { en: "Amara Tchoumi", fr: "Amara Tchoumi" }, bio: { en: "Illustrator and brand designer working with African startups.", fr: "Illustratrice et designer de marque pour startups africaines." }, place: "Yaoundé", offer: { en: "Work", fr: "Réalisations" }, cover: ["#164E63", "#0A0A0A"], subcategory: "designer", items: [{ n: { en: "Logo & identity", fr: "Logo et identité" }, price: 120000, c: ["#06B6D4", "#164E63"] }, { n: { en: "Illustration pack", fr: "Pack d'illustrations" }, price: 45000, c: ["#F472B6", "#831843"] }] },
  construction_home_services: { name: { en: "Solid Build Cameroon", fr: "Solid Build Cameroun" }, bio: { en: "Building, plumbing and electrical work done right.", fr: "Construction, plomberie et électricité, bien faites." }, place: "Douala", offer: { en: "Services", fr: "Services" }, cover: ["#44403C", "#0A0A0A"], items: [{ n: { en: "House extension", fr: "Extension de maison" }, price: 2500000, c: ["#F59E0B", "#78350F"] }, { n: { en: "Plumbing repair", fr: "Réparation de plomberie" }, price: 15000, c: ["#38BDF8", "#075985"] }] },
  agriculture_agribusiness: { name: { en: "Ferme Soleil", fr: "Ferme Soleil" }, bio: { en: "Fresh produce and cocoa from our own farm.", fr: "Produits frais et cacao de notre propre ferme." }, place: "Bafoussam", offer: { en: "Produce", fr: "Produits" }, cover: ["#365314", "#0A0A0A"], items: [{ n: { en: "Cocoa, 25 kg", fr: "Cacao, 25 kg" }, price: 45000, c: ["#92400E", "#451A03"] }, { n: { en: "Tomatoes crate", fr: "Caisse de tomates" }, price: 8000, c: ["#EF4444", "#7F1D1D"] }] },
  other: { name: { en: "Ringo Example", fr: "Exemple Ringo" }, bio: { en: "A simple page with everything in one place.", fr: "Une page simple avec tout au même endroit." }, place: "Douala", offer: { en: "Catalog", fr: "Catalogue" }, cover: ["#334155", "#0A0A0A"], items: [{ n: { en: "Item one", fr: "Article un" }, price: 5000, c: ["#94A3B8", "#334155"] }, { n: { en: "Item two", fr: "Article deux" }, price: 7500, c: ["#A78BFA", "#4C1D95"] }] },
};

export const PREVIEW_CATEGORY_IDS = CATEGORIES.map((c) => c.id) as string[];

export interface PreviewOptions {
  category: string;
  lang: "en" | "fr";
  accent: string;
  bg: string;
  text: string;
  bgStyle: string;
  button: string;
  radius: string;
  long: boolean;
  minimal: boolean;
  many?: boolean; // ten catalogue items instead of the seed's three (to see a long collection, e.g. the horizontal rail)
}

export function buildPreviewProfile(o: PreviewOptions) {
  const seed = SEEDS[o.category] || SEEDS.other;
  const l = o.lang;
  const longName = o.long ? (l === "fr" ? "Établissements Fotsing-Nana & Fils, Négoce Général, Import-Export" : "Fotsing-Nana & Sons General Trading, Import-Export and Distribution Ltd") : null;
  const isMusic = o.category === "music_entertainment";
  const hasTicketing = isMusic || o.category === "events_experiences";
  return {
    id: "preview", user_id: "preview", username: "preview", name: longName || seed.name[l], bio: o.minimal ? null : seed.bio[l],
    category: o.category, categories: [o.category], subcategory: seed.subcategory || null, music_role: isMusic ? "artist" : null,
    published: true, verified: true, currency: "XAF", whatsapp_number: "+237 677 12 34 56",
    avatar_url: art(seed.cover[0], "#D4A954", o.category === "freelancers_creators" || o.category === "professional_services" ? "face" : "logo"),
    cover_image_url: o.minimal ? null : art(seed.cover[0], seed.cover[1], "photo"),
    bookings_enabled: true, ordering_enabled: o.category === "restaurant_food", hub_support_enabled: isMusic,
    pinned_type: null, pinned_id: null,
    tracks: isMusic ? [{ id: "t1", title: "My Era", artist_name: "Jay Kay", duration: "3:12", price: 500, protected_audio_path: "x", preview_audio_url: "/p.mp3", cover_image_url: art("#7C3AED", "#1E1B4B"), sort_order: 0, available: true }] : [],
    music_releases: isMusic && o.many ? Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, title: (l === "fr" ? "Sortie " : "Release ") + (i + 1), release_type: i % 2 ? "album" : "ep", price: 2000 + i * 500, cover_image_url: art("#7C3AED", "#1E1B4B"), available: true, sort_order: i })) : [],
    products: (o.many ? Array.from({ length: 10 }, (_, i) => ({ ...seed.items[i % seed.items.length], n: { en: `${seed.items[i % seed.items.length].n.en} ${i + 1}`, fr: `${seed.items[i % seed.items.length].n.fr} ${i + 1}` } })) : seed.items).map((it, i) => ({ id: `p${i}`, profile_id: "preview", name: it.n[l], price: it.price, image_url: art(it.c[0], it.c[1]), images: [art(it.c[0], it.c[1])], available: true, sort_order: i, description: null })),
    menu_items: o.category === "restaurant_food" ? seed.items.map((it, i) => ({ id: `m${i}`, name: it.n[l], price: it.price, image_url: art(it.c[0], it.c[1]), available: true, featured: i === 0, sort_order: i })) : [],
    events: hasTicketing ? [{ id: "e1", title: l === "fr" ? "Nuit de lancement" : "Launch night", event_date: "2026-12-05", event_time: "20:00", location: seed.place, price: 3000, status: "published", sort_order: 0, event_ticket_types: [] }, { id: "e2", title: l === "fr" ? "Scène ouverte" : "Open stage", event_date: "2027-01-16", event_time: "19:00", location: seed.place, price: 2000, status: "published", sort_order: 1, event_ticket_types: [] }, ...(o.many ? [2, 3].map((k) => ({ id: `e${k + 1}`, title: (l === "fr" ? "Soirée " : "Night ") + (k + 1), event_date: `2027-0${k}-20`, event_time: "21:00", location: seed.place, price: 1500, status: "published", sort_order: k, event_ticket_types: [] }))  : [])] : [],
    links: o.minimal ? [] : [{ id: "l1", title: l === "fr" ? "Notre site web" : "Our website", url: "https://example.com", description: l === "fr" ? "Tout savoir sur nous" : "Everything about us", sort_order: 0 }, { id: "l2", title: l === "fr" ? "Commander sur WhatsApp" : "Order on WhatsApp", url: "https://wa.me/237677123456", sort_order: 1 }],
    social_links: o.minimal ? [] : [{ id: "s1", platform: "instagram", url: "https://instagram.com/ringo" }, { id: "s2", platform: "facebook", url: "https://facebook.com/ringo" }, { id: "s3", platform: "tiktok", url: "https://tiktok.com/@ringo" }],
    about_position: o.minimal ? null : (l === "fr" ? "Fondateur" : "Founder"), about_company: o.minimal ? null : seed.name[l], about_email: o.minimal ? null : "hello@example.com", about_phone: o.minimal ? null : "+237 677 12 34 56",
    about_location: seed.place, about_hours: o.minimal ? null : (l === "fr" ? "Lun–Sam, 8h–18h" : "Mon–Sat, 8am–6pm"), about_long_bio: null, profile_phone_numbers: [],
    opening_hours: o.category === "restaurant_food" ? { mon: { open: "08:00", close: "22:00", closed: false }, tue: { open: "08:00", close: "22:00", closed: false }, wed: { open: "08:00", close: "22:00", closed: false }, thu: { open: "08:00", close: "22:00", closed: false }, fri: { open: "08:00", close: "23:00", closed: false }, sat: { open: "08:00", close: "23:00", closed: false }, sun: { open: "10:00", close: "20:00", closed: false } } : null,
    theme_color: o.accent, background_style: o.bgStyle, background_color: o.bg, background_gradient_end: o.bgStyle === "gradient" ? "#000000" : null, text_color: o.text, button_style: o.button, button_radius: o.radius,
  };
}
