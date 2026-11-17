import type { EthosSession, BasketItem } from "./types";

const BASE_URL = "https://www.imperial.ac.uk/sport/members";

export function ethosBaseUrl(): string {
  return BASE_URL;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Ethos API expects "YYYY/MM/DD 00:00:00.000"
export function formatEthosDate(dateStr: string): string {
  return dateStr.replace(/-/g, "/") + " 00:00:00.000";
}

// cancel endpoint wants "YYYY/MM/DD HH:mm:ss.SSS"
export function formatCancelDate(isoDate: string): string {
  const d = new Date(isoDate);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${y}/${mo}/${day} ${h}:${mi}:${s}.${ms}`;
}

export function buildBasketItem(session: EthosSession, personId: number): BasketItem {
  return {
    Id: 0,
    BasketId: "00000000-0000-0000-0000-000000000000",
    Description: session.DisplayName,
    Type: "Xn.Enrolment",
    DisplayOrder: 1,
    SiteId: session.SiteId,
    GrossAmount: 0,
    VATCode: "S",
    ItemOwnerPersonFK: personId,
    BasketItemMetadata: {
      EnrolmentType: 2,
      GroupCode: session.GroupCode,
      Code: session.CourseCode,
      PriceStruct: session.PriceStruct,
      PriceBand: session.PriceBand,
      CourseOrSes: "S",
      EnrolmentNumber: -1,
      SequenceNo: session.Sequence,
      ActivityGroupId: session.ActivityGroupId,
      LocationTypeSingular: "",
      ActivityCode: session.ActivityCode,
      LocationCode: session.LocationCode,
      SendEmailReminder: "true",
      SendSMSReminder: "false",
      DurationDescription: session.DurationDescription,
      LocationDescription: session.LocationDescription,
      StartTime: session.StartTime,
      EndTime: session.EndTime,
      SiteName: "Ethos",
    },
  };
}

export function parseFormField(html: string, fieldName: string): string | null {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<input[^>]*name=["']${escaped}["'][^>]*value=["']([^"']*)["']`,
    "i"
  );
  const match = html.match(regex);
  if (match) return match[1] ?? null;
  // some pages emit value before name
  const regex2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${escaped}["']`,
    "i"
  );
  const match2 = html.match(regex2);
  return match2?.[1] ?? null;
}

// no sig verification — Ethos doesn't publish JWKS, we only need personId
export function decodeAndValidateJwt(token: string): Record<string, unknown> {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) throw new Error("Invalid JWT");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = atob(padded);
  const claims = JSON.parse(json) as Record<string, unknown>;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now) {
    throw new Error("Ethos token expired");
  }

  return claims;
}

export function formatTime(isoDate: string): string {
  return isoDate.slice(11, 16);
}

export function formatSessionLine(s: EthosSession): string {
  const time = formatTime(s.StartTime);
  const end = formatTime(s.EndTime);
  const spaces = `${s.AvailablePlaces}/${s.TotalPlaces}`;
  const price = s.Price === 0 ? "Free" : `\u00a3${s.Price.toFixed(2)}`;
  return `${s.DisplayName} | ${time}-${end} | ${spaces} | ${s.LocationDescription} | ${price}`;
}

// Ethos GroupCodes as they appear in the timetable API (values are space-padded,
// hence the trim). Only free sessions go through OneClick/Foc, so paid
// activities are listable but not bookable.
export const LOCATIONS = {
  gym: { group: "GYM1", label: "Ethos Gym", bookable: true },
  sw7: { group: "1SW7", label: "1SW7 Gym", bookable: true },
  pool: { group: "STT1", label: "Ethos Pool", bookable: true },
  induction: { group: "GIND", label: "Gym induction", bookable: true },
  classes: { group: "CT", label: "Fitness classes (paid)", bookable: false },
  squash: { group: "SQ", label: "Squash courts (paid)", bookable: false },
  climbing: { group: "Climb", label: "Climbing wall (paid)", bookable: false },
} as const;

export type Location = keyof typeof LOCATIONS;

const ALL_LOCATIONS = Object.keys(LOCATIONS) as Location[];
export const LISTABLE_LOCATIONS: [Location | "all", ...(Location | "all")[]] = ["all", ...ALL_LOCATIONS];
export const BOOKABLE_LOCATIONS = ALL_LOCATIONS.filter((k) => LOCATIONS[k].bookable) as [Location, ...Location[]];

// "gym=Ethos Gym, pool=Ethos Pool, ..." for tool and parameter descriptions
export function describeLocations(keys: readonly (Location | "all")[]): string {
  return keys
    .map((k) => (k === "all" ? "all=everything" : `${k}=${LOCATIONS[k].label}`))
    .join(", ");
}

export function locationFilter(location: Location | "all"): (s: EthosSession) => boolean {
  if (location === "all") return () => true;
  const group = LOCATIONS[location].group;
  return (s) => s.GroupCode.trim() === group;
}

// Ethos timestamps are naive Europe/London times ("2026-11-19T14:00:00"),
// so compare against London wall-clock time rather than UTC.
export function londonNow(): string {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/London", hour12: false })
    .replace(" ", "T");
}
