// Ringo AI Content Calendar — the compact chat-side summary card
// create_content_calendar emits. The full month itself lives in the
// dedicated Content Calendar view (fetched separately by profile_id/year/
// month), not replayed from chat history — same "card is a pointer, not the
// source of truth" relationship DraftCard/ContentCard already have to their
// own tables.

export interface CalendarPlanView {
  id: string;
  year: number;
  month: number;
  itemCount: number;
  items: { id: string; scheduledDate: string; title: string | null; contentType: string }[];
}
