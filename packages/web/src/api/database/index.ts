import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const databaseAuthToken = process.env.DATABASE_AUTH_TOKEN;

/**
 * Database access is only initialized when DATABASE_URL is configured.
 * This keeps local/unit-test imports side-effect free while production can
 * opt into durable Turso persistence explicitly.
 */
export const db = databaseUrl
  ? drizzle(createClient({ url: databaseUrl, authToken: databaseAuthToken }), { schema })
  : null;

export function requireDatabase() {
  if (!db) throw new Error("DATABASE_URL is required for durable football prediction persistence");
  return db;
}
