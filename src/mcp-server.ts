import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import type { EthosSession, EthosProps } from "./types";
import { listSessions, bookSession, getBookings, cancelBooking } from "./ethos-api";
import { formatSessionLine, locationFilter, formatTime } from "./utils";

// surfaced so callers don't discover limits through trial-and-error
const LIMITS = {
  bookingsPerDay: 2,
  advanceDays: 7,
  searchDays: 7,
  listResults: 20,
} as const;

function limitsBlock(): string {
  return [
    `max_bookings_per_day: ${LIMITS.bookingsPerDay}`,
    `max_advance_days: ${LIMITS.advanceDays}`,
    "bookable_price: free (£0) only",
    `search_max_range: ${LIMITS.searchDays} days per call`,
  ].join("\n");
}

function getEthosAuth(): { token: string; personId: number; memberNo: number; cookies: string } {
  const ctx = getMcpAuthContext();
  const props = ctx?.props as EthosProps | undefined;
  if (!props?.accessToken) {
    throw new Error("Not authenticated. Please reconnect and log in via the OAuth flow.");
  }

  return {
    token: props.accessToken,
    personId: props.personId,
    memberNo: props.memberNo,
    cookies: props.cookies,
  };
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const dateSchema = z.iso.date().describe("YYYY-MM-DD, today or within 7 days");
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM").describe("Start time HH:MM 24h, e.g. '14:00'. Must match exactly.");

export function createServer(): McpServer {
  const server = new McpServer({ name: "ethos-booker", version: "1.0.0" });

  server.tool(
    "list_sessions",
    `List gym/swim/sport sessions for a single date. Returns a table: Name | Time | Spaces (available/total) | Location | Price. Date must be within ${LIMITS.advanceDays} days of today. Returns up to ${LIMITS.listResults} results. Set available_only=true to hide fully booked sessions. Location codes: gym=Ethos Gym, sw7=1SW7 Gym, pool=Ethos Pool, all=everything.`,
    {
      date: dateSchema,
      location: z.enum(["gym", "sw7", "pool", "all"]).default("all").describe("gym=Ethos Gym, sw7=1SW7 Gym, pool=Ethos Pool, all=no filter"),
      available_only: z.boolean().default(false).describe("If true, hide sessions with 0 open spots. Set true when planning to book."),
    },
    async ({ date, location, available_only }) => {
      const { token, personId, cookies } = getEthosAuth();
      const sessions = await listSessions(token, personId, date, cookies);
      let filtered = sessions.filter(locationFilter(location));
      const countBefore = filtered.length;
      if (available_only) {
        filtered = filtered.filter((s) => s.AvailablePlaces > 0);
      }
      const sorted = filtered.sort((a, b) => a.StartTime.localeCompare(b.StartTime));
      const capped = sorted.slice(0, LIMITS.listResults);

      const fullyBooked = available_only
        ? countBefore - sorted.length
        : sorted.filter((s) => s.AvailablePlaces === 0).length;
      const meta = `date: ${date} | location: ${location} | showing: ${capped.length}/${sorted.length} sessions | ` +
        (available_only ? `${fullyBooked} fully booked hidden` : `${fullyBooked} fully booked`);

      if (capped.length === 0) return text(`${meta}\n\nNo sessions found.`);
      const header = "Name | Time | Spaces | Location | Price";
      const sep = "---|---|---|---|---";
      const rows = capped.map(formatSessionLine);
      const footer = sorted.length > LIMITS.listResults ? `\n... and ${sorted.length - LIMITS.listResults} more` : "";
      return text(`${meta}\n\n${header}\n${sep}\n${rows.join("\n")}${footer}`);
    }
  );

  server.tool(
    "book_session",
    `Book a single free (£0) gym/swim session. Max ${LIMITS.bookingsPerDay} bookings per day, date must be within ${LIMITS.advanceDays} days of today. Returns available alternatives if session is full or not found. Call my_bookings first to check remaining daily capacity. For multiple sessions, call this tool once per session.`,
    {
      date: dateSchema,
      time: timeSchema,
      location: z.enum(["gym", "sw7", "pool"]).default("gym").describe("gym=Ethos Gym, sw7=1SW7 Gym, pool=Ethos Pool"),
    },
    async ({ date, time, location }) => {
      const { token, personId, cookies } = getEthosAuth();

      // bail early if daily cap already hit
      const bookings = await getBookings(token, cookies);
      const onDate = bookings.filter((b) => b.StartTime.startsWith(date));
      if (onDate.length >= LIMITS.bookingsPerDay) {
        return text(
          `DAILY LIMIT REACHED: ${onDate.length}/${LIMITS.bookingsPerDay} bookings on ${date}:\n` +
          onDate.map((b) => `  - ${b.Activity} at ${formatTime(b.StartTime)}`).join("\n") +
          "\nCancel one first to free a slot."
        );
      }

      const sessions = await listSessions(token, personId, date, cookies);
      const match = sessions.find(
        (s) =>
          s.StartTime.includes(`T${time}`) &&
          locationFilter(location)(s) &&
          s.Price === 0
      );
      if (!match) {
        const alts = sessions
          .filter(locationFilter(location))
          .filter((s) => s.Price === 0 && s.AvailablePlaces > 0)
          .map((s) => `${formatTime(s.StartTime)} (${s.AvailablePlaces} spots)`)
          .join(", ");
        return text(
          `NO MATCH: No free ${location} session at ${time} on ${date}.\n` +
          `Available times: ${alts || "none"}`
        );
      }
      if (match.AvailablePlaces === 0) {
        return text(`FULL: ${match.DisplayName} — 0/${match.TotalPlaces} spots at ${time} on ${date}.`);
      }

      try {
        await bookSession(token, match, personId, cookies);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const lower = msg.toLowerCase();
        if (lower.includes("limit") || lower.includes("maximum")) {
          return text(`BOOKING LIMIT: ${msg}\nDaily cap is ${LIMITS.bookingsPerDay}. Check my_bookings.`);
        }
        if (lower.includes("advance") || lower.includes("ahead")) {
          return text(`ADVANCE LIMIT: ${msg}\nMax ${LIMITS.advanceDays} days ahead.`);
        }
        return text(`BOOKING FAILED: ${msg}`);
      }

      const remaining = LIMITS.bookingsPerDay - onDate.length - 1;
      return text(
        `BOOKED: ${match.DisplayName} | ${date} ${time}-${formatTime(match.EndTime)} | ${match.LocationDescription}\n` +
        `Remaining today: ${remaining}/${LIMITS.bookingsPerDay}`
      );
    }
  );

  server.tool(
    "cancel_booking",
    "Cancel an existing booking by date and optional time. Without time, cancels the first cancellable booking that day. Only CanCancel=true bookings (shown in my_bookings) can be cancelled. Cancelling frees a daily booking slot.",
    {
      date: dateSchema,
      time: timeSchema.optional().describe("HH:MM 24h. Omit to cancel first match on this date."),
    },
    async ({ date, time }) => {
      const { token, cookies } = getEthosAuth();
      const bookings = await getBookings(token, cookies);
      const cancellable = bookings.filter((b) => b.CanCancel && b.StartTime.startsWith(date));
      if (cancellable.length === 0) {
        const allOnDate = bookings.filter((b) => b.StartTime.startsWith(date));
        if (allOnDate.length > 0) {
          return text(`Found ${allOnDate.length} booking(s) on ${date} but none are cancellable (may be too close to start).`);
        }
        return text(`No bookings on ${date}.`);
      }
      const match = time
        ? cancellable.find((b) => b.StartTime.includes(`T${time}`))
        : cancellable[0];
      if (!match) {
        const opts = cancellable.map((b) => `${b.Activity} at ${formatTime(b.StartTime)}`).join(", ");
        return text(`Nothing at ${time} on ${date}. Cancellable: ${opts}`);
      }
      await cancelBooking(token, match, cookies);
      return text(`CANCELLED: ${match.Activity} | ${date} ${formatTime(match.StartTime)}`);
    }
  );

  server.tool(
    "my_bookings",
    `Show upcoming bookings with per-day usage out of ${LIMITS.bookingsPerDay} daily slots. Returns: Activity | Date | Time | Location | CanCancel. Call this before book_session to check remaining capacity.`,
    {},
    async () => {
      const { token, cookies } = getEthosAuth();
      const bookings = await getBookings(token, cookies);
      const now = new Date().toISOString();
      const upcoming = bookings
        .filter((b) => b.StartTime > now)
        .sort((a, b) => a.StartTime.localeCompare(b.StartTime))
        .slice(0, 15);

      const perDay = new Map<string, number>();
      for (const b of upcoming) {
        const day = b.StartTime.slice(0, 10);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }

      const summary = [
        `total_upcoming: ${upcoming.length}`,
        `max_bookings_per_day: ${LIMITS.bookingsPerDay}`,
        `max_advance_days: ${LIMITS.advanceDays}`,
        `earliest_bookable_date: ${todayStr()}`,
      ];
      if (perDay.size > 0) {
        summary.push("daily_usage:");
        for (const [day, count] of perDay) {
          summary.push(`  ${day}: ${count}/${LIMITS.bookingsPerDay} used (${LIMITS.bookingsPerDay - count} left)`);
        }
      }

      if (upcoming.length === 0) return text(`${summary.join("\n")}\n\nNo upcoming bookings.`);

      const header = "Activity | Date | Time | Location | CanCancel";
      const sep = "---|---|---|---|---";
      const rows = upcoming.map(
        (b) => `${b.Activity} | ${b.StartTime.slice(0, 10)} | ${formatTime(b.StartTime)} | ${b.Location} | ${b.CanCancel ? "Yes" : "No"}`
      );
      return text(`${summary.join("\n")}\n\n${header}\n${sep}\n${rows.join("\n")}`);
    }
  );

  server.tool(
    "search_sessions",
    `Search for available sessions across a date range (max ${LIMITS.searchDays} days). Only returns sessions with open spots — fully booked are excluded. Results grouped by date. Time filters: morning=07-12, afternoon=12-18, evening=18+. Dates must be within ${LIMITS.advanceDays} days of today.`,
    {
      start_date: dateSchema,
      end_date: z.iso.date().describe("YYYY-MM-DD, max 7 days from start_date"),
      time_preference: z.enum(["morning", "afternoon", "evening", "any"]).default("any").describe("morning=07-12, afternoon=12-18, evening=18+, any=all"),
      activity: z.string().optional().describe("Case-insensitive partial match, e.g. 'gym' or 'swim'"),
      location: z.enum(["gym", "sw7", "pool", "all"]).default("all").describe("gym=Ethos Gym, sw7=1SW7 Gym, pool=Ethos Pool, all=no filter"),
    },
    async ({ start_date, end_date, time_preference, activity, location }) => {
      const { token, personId, cookies } = getEthosAuth();
      const timeFilter = (s: EthosSession): boolean => {
        const hour = parseInt(formatTime(s.StartTime).split(":")[0] ?? "0");
        switch (time_preference) {
          case "morning": return hour >= 7 && hour < 12;
          case "afternoon": return hour >= 12 && hour < 18;
          case "evening": return hour >= 18;
          default: return true;
        }
      };

      const results: string[] = [];
      const start = new Date(start_date);
      const end = new Date(end_date);
      let days = 0;
      let found = 0;
      let excluded = 0;

      for (let d = new Date(start); d <= end && days < LIMITS.searchDays; d.setDate(d.getDate() + 1), days++) {
        const dateStr = d.toISOString().slice(0, 10);
        const sessions = await listSessions(token, personId, dateStr, cookies);
        const matched = sessions
          .filter(locationFilter(location))
          .filter(timeFilter)
          .filter((s) => !activity || s.DisplayName.toLowerCase().includes(activity.toLowerCase()));
        excluded += matched.filter((s) => s.AvailablePlaces === 0).length;
        const open = matched.filter((s) => s.AvailablePlaces > 0);
        found += open.length;
        if (open.length > 0) {
          results.push(`**${dateStr}**`);
          for (const s of open.slice(0, 10)) {
            results.push(formatSessionLine(s));
          }
        }
      }

      const meta = `days_searched: ${days} | available: ${found} | fully_booked_excluded: ${excluded} | filters: time=${time_preference}, location=${location}${activity ? `, activity=${activity}` : ""}`;

      if (results.length === 0) return text(`${meta}\n\nNo available sessions found.`);
      return text(`${meta}\n\n${limitsBlock()}\n\n${results.join("\n")}`);
    }
  );

  return server;
}
