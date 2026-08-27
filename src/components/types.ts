export interface PublicQuestion {
  id: string;
  prompt: string;
  kind: 'text' | 'yes_no' | 'single_choice';
  required: boolean;
  options: string[];
}

export interface PublicEventType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  color: string;
}

export interface PublicConfig {
  name: string;
  timezone: string;
  branding: { logoUrl?: string; accentColor?: string; buttonColor?: string };
  otherPath: {
    message: string;
    redirectUrl: string | null;
    redirectLabel: string | null;
  };
}

export interface DaySlots {
  date: string;
  slots: string[];
}
