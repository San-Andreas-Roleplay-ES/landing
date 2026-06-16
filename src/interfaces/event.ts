export interface ServerEvent {
  id: number;
  title: string;
  description: string;
  /** Source URL on i.imgur.com; mirrored locally to /images/events/<id>.<ext> at build. */
  image_url: string;
  /** "YYYY-MM-DD HH:mm:ss", server-local time, no timezone offset. */
  event_date: string;
}

export interface EventsResponse {
  generatedAt: string;
  data: ServerEvent[];
}

/** A ServerEvent enriched at build time with the local mirrored image and past/future state. */
export interface DisplayEvent extends ServerEvent {
  /** Root-relative path to the mirrored image under public/, or null if the mirror is missing. */
  localImage: string | null;
  /** True when event_date is in the past relative to build time. */
  isPast: boolean;
}
