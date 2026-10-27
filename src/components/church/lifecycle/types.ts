import type { ReactNode } from "react";
import type { Translations } from "@/lib/i18n/translations";
import type { ChurchCapabilities } from "@/lib/church/permissions";

// The shared draft -> publish screens of the church workspace (Events, Announcements, Bible programs). One list and one editor, driven by a small config per entity (the fields, the readiness
// rule, the public preview) and a block of texts per entity (so French agreement and wording stay natural: "cet événement", "cette annonce", "ce programme").

export type Lang = "en" | "fr";

export interface FieldDef {
  /** The column. A bilingual field is stored as `<key>_en` and `<key>_fr`. */
  key: string;
  bilingual?: boolean;
  kind: "text" | "textarea" | "date" | "time" | "url" | "checkbox" | "select" | "image";
  /** For a "select": the allowed values, in display order (their labels are in the field text's `options`). */
  choices?: readonly string[];
  max?: number;
  /** Textarea height in rows. */
  rows?: number;
  /** Marked as optional in the label. */
  optional?: boolean;
  /** Shown in two columns beside the next field on wide screens. */
  half?: boolean;
  /** For a "date": quick choices that fill it in. "announcement" = This week (until Sunday midnight), 1 month, 1 year, No end date (labels in the field text's `options`: week, month, year, none, date). */
  presets?: "announcement";
  /** Shown only while this other field has a value (the care picture's "the person agreed" box appears once a picture is chosen). Clearing that field also clears this one. */
  visibleWhen?: string;
}

export interface FieldText {
  label: string;
  placeholder?: string;
  help?: string;
  /** For a "select": the label of each choice. */
  options?: Record<string, string>;
}

export interface LifecycleTexts {
  subtitle: string;
  list: {
    add: string;
    count: (n: number) => string;
    emptyTitle: string;
    emptyBody: string;
    emptyFilteredTitle: string;
    loadError: string;
    untitled: string;
    viewLabel: string;
    views: Record<string, string>;
    state: Record<string, string>;
    languages: { en: string; fr: string };
    languageReady: (lang: string) => string;
    languageMissing: (lang: string) => string;
    open: (title: string) => string;
  };
  editor: {
    newTitle: string;
    editTitle: string;
    back: string;
    languageTabs: string;
    languages: { en: string; fr: string };
    languageReady: string;
    languageIncomplete: string;
    optional: string;
    characters: (n: number, max: number) => string;
    saveDraft: string;
    save: string;
    saving: string;
    saved: string;
    created: string;
    preview: string;
    previewTitle: string;
    previewLanguage: string;
    previewNote: string;
    previewEmpty: string;
    publish: string;
    unpublish: string;
    delete: string;
    saveFirst: string;
    needsReady: string;
    publishNeedsPermission: string;
    viewOnly: string;
    liveBanner: string;
    unsaved: string;
    leaveWarning: string;
    publishTitle: string;
    publishBody: string;
    publishConfirm: string;
    published: string;
    unpublishTitle: string;
    unpublishBody: string;
    unpublishConfirm: string;
    unpublished: string;
    deleteDraftTitle: string;
    deleteDraftBody: string;
    deleteLiveTitle: string;
    deleteLiveBody: string;
    deleteConfirm: string;
    stale: string;
    reload: string;
    loadError: string;
  };
  fields: Record<string, FieldText>;
}

export type FormValues = Record<string, string | boolean>;

export interface LifecycleConfig {
  /** "/api/church/events" */
  apiPath: string;
  /** "/dashboard/church/events" */
  pagePath: string;
  /** Prefix of element ids (unique per entity). */
  idPrefix: string;
  texts: LifecycleTexts;
  /** Which entries the list may be filtered to ("all" first). */
  views: readonly string[];
  /** Fields shown above the language tabs (not bilingual) then inside the tabs (bilingual). */
  fields: FieldDef[];
  /** Is the entry readable (publishable) in this language? */
  ready: (form: FormValues, lang: Lang) => boolean;
  /** The blank form of a new entry. */
  blank: (today: string) => FormValues;
  /** The public card drawn in the preview, from what is on screen. */
  renderPreview: (form: FormValues, lang: Lang, t: Translations) => ReactNode;
  /** The sentence under a list row's title (a date, an end date…). */
  subline: (row: Record<string, any>, locale: Lang, formatDay: (d: string, l: string) => string) => string;
  /** The title a list row shows. */
  rowTitle: (row: Record<string, any>, locale: Lang) => string;
  stateTone: Record<string, string>;
  caps: { view: (c: ChurchCapabilities) => boolean; manage: (c: ChurchCapabilities) => boolean; publish: (c: ChurchCapabilities) => boolean };
  /** Extra badges on a list row (for example "Cancelled"). */
  extraBadges?: (row: Record<string, any>) => string[];
}
