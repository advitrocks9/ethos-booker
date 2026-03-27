import type { EthosSession, EthosBooking, BookingConfirmation } from "./types";
import { ethosBaseUrl, formatEthosDate, formatCancelDate, buildBasketItem } from "./utils";

const BASE = ethosBaseUrl();
const API = `${BASE}/en/api`;

function authHeaders(token: string, cookies?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (cookies) headers["Cookie"] = cookies;
  return headers;
}

async function apiGet<T>(path: string, token: string, cookies?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: authHeaders(token, cookies) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// The Gladstone platform ties baskets to the user account. If a previous
// booking attempt left stale items, OneClick/Foc refuses to run. We try
// several undocumented endpoints to force-clear the basket state.
async function clearStaleBasket(token: string, cookies?: string): Promise<string> {
  const headers = authHeaders(token, cookies);
  const results: string[] = [];

  const r1 = await fetch(`${API}/Basket`, { method: "DELETE", headers }).catch(() => null);
  if (r1) results.push(`DELETE /Basket: ${r1.status}`);

  const r2 = await fetch(`${API}/Basket/ClearBasket`, { method: "POST", headers, body: "{}" }).catch(() => null);
  if (r2) results.push(`POST /ClearBasket: ${r2.status}`);

  // create a fresh basket and immediately finalise it (empty) to replace the stale one
  const createRes = await fetch(`${API}/Basket`, { method: "POST", headers, body: "{}" }).catch(() => null);
  if (createRes?.ok) {
    const body = await createRes.text();
    results.push(`POST /Basket: ${createRes.status} body=${body.slice(0, 100)}`);
    const guidMatch = body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (guidMatch) {
      const bid = guidMatch[0];
      const payRes = await fetch(`${API}/Basket/PayItemsInBasket`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          basketId: bid,
          successfulpaymentURL: `${BASE}/en/Payments/Confirmation`,
          unsuccessfulpaymentURL: `${BASE}/en/Payments/Unsuccessful`,
          isApiRequest: true,
        }),
      }).catch(() => null);
      if (payRes) results.push(`Pay basket ${bid}: ${payRes.status}`);
    }
  } else if (createRes) {
    const body = await createRes.text();
    results.push(`POST /Basket: ${createRes.status} body=${body.slice(0, 100)}`);
  }

  return results.join("; ");
}

export async function listSessions(
  token: string,
  personId: number,
  date: string,
  cookies?: string
): Promise<EthosSession[]> {
  const ethosDate = encodeURIComponent(formatEthosDate(date));
  return apiGet<EthosSession[]>(
    `/Sites/1/Timetables/Bookings?date=${ethosDate}&pid=${personId}`,
    token,
    cookies
  );
}

async function tryOneClick(
  token: string,
  session: EthosSession,
  personId: number,
  cookies?: string
): Promise<{ ok: true; data: BookingConfirmation } | { ok: false; basketError: boolean; msg: string }> {
  const basketItem = buildBasketItem(session, personId);
  const res = await fetch(`${API}/Payment/OneClick/Foc`, {
    method: "POST",
    headers: authHeaders(token, cookies),
    body: JSON.stringify(basketItem),
  });

  const body = await res.text();

  if (body.trimStart().startsWith("<!DOCTYPE") || body.trimStart().startsWith("<html")) {
    return { ok: false, basketError: false, msg: "Got HTML instead of JSON - session may have expired, try logging in again" };
  }

  if (!res.ok) {
    let msg = `Booking failed (${res.status})`;
    try {
      const err = JSON.parse(body) as { Message?: string };
      if (err.Message) msg = err.Message;
    } catch {
      msg += `: ${body.slice(0, 200)}`;
    }
    const basketError = msg.toLowerCase().includes("basket");
    return { ok: false, basketError, msg };
  }

  return { ok: true, data: JSON.parse(body) as BookingConfirmation };
}

export async function bookSession(
  token: string,
  session: EthosSession,
  personId: number,
  cookies?: string
): Promise<BookingConfirmation> {
  const first = await tryOneClick(token, session, personId, cookies);
  if (first.ok) return first.data;

  if (first.basketError) {
    const clearResult = await clearStaleBasket(token, cookies);
    const retry = await tryOneClick(token, session, personId, cookies);
    if (retry.ok) return retry.data;
    throw new Error(`${retry.msg}. Basket clearing attempt: ${clearResult}`);
  }

  throw new Error(first.msg);
}

export async function getBookings(token: string, cookies?: string): Promise<EthosBooking[]> {
  return apiGet<EthosBooking[]>("/Bookings/History", token, cookies);
}

export async function cancelBooking(
  token: string,
  booking: EthosBooking,
  cookies?: string
): Promise<void> {
  const params = new URLSearchParams({
    siteId: String(booking.SiteId),
    groupCode: booking.GroupCode,
    code: booking.Code,
    courseOrSes: booking.CourseOrClass,
    enrolDate: formatCancelDate(booking.BookingDate),
    enrolmentNo: String(booking.EnrolmentNo),
    eventStartTime: formatCancelDate(booking.StartTime),
    description: booking.Activity,
    bookedForMemberNo: String(booking.BookedForMemberNo),
  });

  const res = await fetch(
    `${API}/Bookings/CancelEnrolment?${params.toString()}`,
    {
      method: "DELETE",
      headers: authHeaders(token, cookies),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cancel failed (${res.status}): ${body.slice(0, 200)}`);
  }
}
