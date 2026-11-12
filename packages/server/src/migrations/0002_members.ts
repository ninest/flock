// Members and their sign-in data. The Better Auth tables were generated once with
// `getMigrations(...).compileMigrations()` (better-auth 1.7.22, with the model names
// in src/auth.ts) and frozen here. On a Better Auth upgrade, diff with getMigrations
// against a database at the current schema and add a new forward migration.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

const betterAuthSchema = [
  `create table "member" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`,
  `create table "member_session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "member" ("id") on delete cascade)`,
  `create table "member_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "member" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null)`,
  `create table "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`,
  `create index "member_session_userId_idx" on "member_session" ("userId")`,
  `create index "member_account_userId_idx" on "member_account" ("userId")`,
  `create index "auth_verification_identifier_idx" on "auth_verification" ("identifier")`
]

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // One statement per call: the extended protocol rejects multi-statement strings.
  for (const statement of betterAuthSchema) yield* sql.unsafe(statement)
  yield* sql`
    CREATE TABLE instance_admin (
      member_id text PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
      granted_at timestamptz NOT NULL DEFAULT now()
    )`
})
