import type { EthosSession, BasketItem } from "./types";

const BASE_URL = "https://www.imperial.ac.uk/sport/members";

export function ethosBaseUrl(): string {
  return BASE_URL;
}

// Ethos API expects dates as "YYYY/MM/DD 00:00:00.000"
export function formatEthosDate(dateStr: string): string {
  return dateStr.replace(/-/g, "/") + " 00:00:00.000";
}

// Cancel endpoint expects full datetime: "YYYY/MM/DD HH:mm:ss.SSS"
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
  const regex = new RegExp(
    `<input[^>]*name=["']${fieldName}["'][^>]*value=["']([^"']*)["']`,
    "i"
  );
  const match = html.match(regex);
  if (match) return match[1] ?? null;
  // handle reversed attribute order
  const regex2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${fieldName}["']`,
    "i"
  );
  const match2 = html.match(regex2);
  return match2?.[1] ?? null;
}

// base64url decode without crypto verification (we just need the claims)
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) throw new Error("Invalid JWT");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = atob(padded);
  return JSON.parse(json) as Record<string, unknown>;
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

export function locationFilter(location: string): (s: EthosSession) => boolean {
  switch (location) {
    case "gym":
      return (s) => s.GroupCode.trim() === "GYM1";
    case "sw7":
      return (s) => s.GroupCode.trim() === "1SW7";
    case "pool":
      return (s) => s.GroupCode.trim() === "SNT1";
    case "all":
    default:
      return () => true;
  }
}
