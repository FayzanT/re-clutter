// Shared helpers for the scripts in this folder: local logins, SQL on the
// devserver's Postgres, and calls to A's API.
// The scripts run through their .sh wrappers, which load the devserver's
// local secrets the same way backend/devserver/smoke.sh does.

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";

export const API = process.env.LIVE_API ?? "http://localhost:8787";
export const WS = process.env.LIVE_WS ?? "ws://127.0.0.1:8791";
export const ORIGIN = "http://localhost:3000";
const PG_CONTAINER = "clutter-devserver-postgres";
const JWT_SECRET = process.env.JWT_SECRET ?? "";

// Stop if we were not started by a wrapper with the devserver's secret.
export function requireDevSecret(script: string): void {
  if (!JWT_SECRET.startsWith("devserver-local-")) {
    console.error(`${script}: run me through my .sh wrapper (JWT_SECRET is not the devserver's)`);
    process.exit(2);
  }
}

export interface Identity {
  id: string;
  email: string;
  name: string;
}

// The same claims and HS256 signature as the log-in Lambda and devauth.Sign.
// createdAt is the user's row's created_at.
export function sign(u: Identity, expSeconds: number, secret = JWT_SECRET, createdAt = new Date().toISOString()): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const header = enc({ alg: "HS256", typ: "JWT" });
  const payload = enc({ sub: u.id, email: u.email, full_name: u.name, picture_url: "", created_at: createdAt, exp: expSeconds });
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// A day, the log-in Lambda's token lifetime.
export const inADay = (): number => Math.floor(Date.now() / 1000) + 24 * 3600;

// Runs SQL in the devserver's Postgres container and returns psql's plain output.
// Only pass values this script made itself (UUIDs, fixed emails), never outside input.
export function sql(statement: string): string {
  return execFileSync("docker", ["exec", "-i", PG_CONTAINER, "psql", "-U", "clutter", "-d", "clutter", "-v", "ON_ERROR_STOP=1", "-tA"], {
    input: statement,
    encoding: "utf8",
  }).trim();
}

export async function api(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON; keep the text
  }
  return { status: res.status, json };
}

// Like api, but throws unless the answer is 200 or 201.
export async function must(method: string, path: string, token: string, body?: unknown): Promise<any> {
  const r = await api(method, path, token, body);
  if (r.status !== 200 && r.status !== 201) throw new Error(`${method} ${path} gave ${r.status}`);
  return r.json;
}
