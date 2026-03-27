import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentState, Env, EthosSession } from "./types";
import { authenticate } from "./ethos-auth";
import { listSessions, bookSession, getBookings, cancelBooking } from "./ethos-api";
import { formatSessionLine, locationFilter, formatTime } from "./utils";

function requireAuth(state: AgentState): { token: string; personId: number; memberNo: number; cookies: string | undefined } {
  if (!state.authToken || !state.personId) {
    throw new Error("Not logged in. Use the login tool first with your Imperial/Ethos email and password.");
  }
  return { token: state.authToken, personId: state.personId, memberNo: state.memberNo ?? 0, cookies: state.cookies ?? undefined };
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export class EthosAgent extends McpAgent<Env, AgentState> {
  server = new McpServer({ name: "ethos-booker", version: "1.0.0" });
  initialState: AgentState = { authToken: null, personId: null, memberNo: null, cookies: null };

  async init(): Promise<void> {
    this.server.tool(
      "login",
      "Log in to Imperial College Ethos gym booking system",
      { email: z.string().describe("Ethos email"), password: z.string().describe("Ethos password") },
      async ({ email, password }) => {
        const result = await authenticate(email, password);
        this.setState({
          authToken: result.accessToken,
          personId: result.personId,
          memberNo: result.memberNo,
          cookies: result.cookies,
        });
        return text(`Logged in. Person ID: ${result.personId}`);
      }
    );

    this.server.tool(
      "list_sessions",
      "List available sessions for a date. Returns name, time, spaces, location, price.",
      {
        date: z.string().describe("Date YYYY-MM-DD"),
        location: z.enum(["gym", "sw7", "pool", "all"]).default("all").describe("Filter by location"),
      },
      async ({ date, location }) => {
        const { token, personId, cookies } = requireAuth(this.state);
        const sessions = await listSessions(token, personId, date, cookies);
        const filtered = sessions.filter(locationFilter(location));
        const sorted = filtered.sort(
          (a, b) => a.StartTime.localeCompare(b.StartTime)
        );
        const capped = sorted.slice(0, 20);
        if (capped.length === 0) return text(`No sessions for ${date} (${location})`);
        const header = "Name | Time | Spaces | Location | Price";
        const sep = "---|---|---|---|---";
        const rows = capped.map(formatSessionLine);
        const footer = sorted.length > 20 ? `\n... and ${sorted.length - 20} more` : "";
        return text(`${header}\n${sep}\n${rows.join("\n")}${footer}`);
      }
    );

    this.server.tool(
      "book_session",
      "Book a free gym/swim session. Provide date and start time.",
      {
        date: z.string().describe("Date YYYY-MM-DD"),
        time: z.string().describe("Start time HH:MM, e.g. '14:00'"),
        location: z.enum(["gym", "sw7", "pool"]).default("gym").describe("Which facility"),
      },
      async ({ date, time, location }) => {
        const { token, personId, cookies } = requireAuth(this.state);
        const sessions = await listSessions(token, personId, date, cookies);
        const match = sessions.find(
          (s) =>
            s.StartTime.includes(`T${time}`) &&
            locationFilter(location)(s) &&
            s.Price === 0
        );
        if (!match) {
          const available = sessions
            .filter(locationFilter(location))
            .filter((s) => s.Price === 0 && s.AvailablePlaces > 0)
            .map((s) => formatTime(s.StartTime))
            .join(", ");
          return text(`No free ${location} session at ${time} on ${date}. Available times: ${available || "none"}`);
        }
        if (match.AvailablePlaces === 0) {
          return text(`${match.DisplayName} is full (0/${match.TotalPlaces})`);
        }
        await bookSession(token, match, personId, cookies);
        return text(
          `Booked: ${match.DisplayName} | ${date} ${time}-${formatTime(match.EndTime)} | ${match.LocationDescription}`
        );
      }
    );

    this.server.tool(
      "cancel_booking",
      "Cancel an existing booking by date and optional time.",
      {
        date: z.string().describe("Date YYYY-MM-DD"),
        time: z.string().optional().describe("Start time HH:MM (if omitted, cancels first match)"),
      },
      async ({ date, time }) => {
        const { token, cookies } = requireAuth(this.state);
        const bookings = await getBookings(token, cookies);
        const future = bookings.filter(
          (b) => b.CanCancel && b.StartTime.startsWith(date)
        );
        const match = time
          ? future.find((b) => b.StartTime.includes(`T${time}`))
          : future[0];
        if (!match) return text(`No cancellable booking on ${date}${time ? ` at ${time}` : ""}`);
        await cancelBooking(token, match, cookies);
        return text(`Cancelled: ${match.Activity} | ${date} ${formatTime(match.StartTime)}`);
      }
    );

    this.server.tool(
      "my_bookings",
      "Show upcoming bookings.",
      {},
      async () => {
        const { token, cookies } = requireAuth(this.state);
        const bookings = await getBookings(token, cookies);
        const now = new Date().toISOString();
        const upcoming = bookings
          .filter((b) => b.StartTime > now)
          .sort((a, b) => a.StartTime.localeCompare(b.StartTime))
          .slice(0, 10);
        if (upcoming.length === 0) return text("No upcoming bookings");
        const header = "Activity | Date | Time | Location | Cancel?";
        const sep = "---|---|---|---|---";
        const rows = upcoming.map(
          (b) =>
            `${b.Activity} | ${b.StartTime.slice(0, 10)} | ${formatTime(b.StartTime)} | ${b.Location} | ${b.CanCancel ? "Yes" : "No"}`
        );
        return text(`${header}\n${sep}\n${rows.join("\n")}`);
      }
    );

    this.server.tool(
      "search_sessions",
      "Search sessions across a date range with optional time/activity filter.",
      {
        start_date: z.string().describe("Start date YYYY-MM-DD"),
        end_date: z.string().describe("End date YYYY-MM-DD"),
        time_preference: z.enum(["morning", "afternoon", "evening", "any"]).default("any").describe("morning=7-12, afternoon=12-18, evening=18-20"),
        activity: z.string().optional().describe("Filter by activity name (partial match)"),
      },
      async ({ start_date, end_date, time_preference, activity }) => {
        const { token, personId, cookies } = requireAuth(this.state);
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
        const maxDays = 7;
        let dayCount = 0;

        for (let d = new Date(start); d <= end && dayCount < maxDays; d.setDate(d.getDate() + 1), dayCount++) {
          const dateStr = d.toISOString().slice(0, 10);
          const sessions = await listSessions(token, personId, dateStr, cookies);
          const filtered = sessions
            .filter(timeFilter)
            .filter((s) => s.AvailablePlaces > 0)
            .filter((s) => !activity || s.DisplayName.toLowerCase().includes(activity.toLowerCase()));
          if (filtered.length > 0) {
            results.push(`**${dateStr}**`);
            for (const s of filtered.slice(0, 10)) {
              results.push(formatSessionLine(s));
            }
          }
        }

        if (results.length === 0) return text("No matching sessions found");
        return text(results.join("\n"));
      }
    );
  }
}
