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
  /* Declared on the service itself (migration 0013). A client cannot buy a
     pack through intro yet — there is no checkout — so this is shown as
     information about what the service is, not as a quantity to choose. */
  bookingMode: 'single' | 'pack';
  packSize: number | null;
  /* Minor units of the tenant's currency (see PublicConfig.currency and
     src/lib/money.ts). Null means no published price — which is not the
     same as free, so nothing is rendered for it. */
  priceMinor: number | null;
  locationKind: 'online' | 'in_person' | 'phone' | null;
  locationDetail: string | null;
}

export interface PublicConfig {
  name: string;
  timezone: string;
  /** ISO 4217, for rendering every price on the page. */
  currency: string;
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
