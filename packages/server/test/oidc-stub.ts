// A stub OIDC issuer for Seam 1: discovery, authorize (auto-approves as the next user),
// token (RS256 id_token echoing the nonce), userinfo and JWKS. Binds 127.0.0.1 on a random port.
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"

export interface StubUser { sub: string; email: string; email_verified: boolean; name?: string }

export const startOidcStub = async (opts: { clientId: string; clientSecret: string }) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }
  let nextUser: StubUser = { sub: "u1", email: "owner@example.com", email_verified: true }
  let lastRedirectUri: string | undefined
  const codes = new Map<string, { user: StubUser; nonce?: string | undefined; redirectUri: string }>()
  const tokens = new Map<string, StubUser>()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer)
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
    }
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid", "email", "profile"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        code_challenge_methods_supported: ["S256"]
      })
    }
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] })
    if (url.pathname === "/authorize") {
      // Auto-approve as `nextUser`. (PKCE challenge is accepted but not verified.)
      const code = randomUUID()
      const redirectUri = url.searchParams.get("redirect_uri")!
      lastRedirectUri = redirectUri
      codes.set(code, { user: nextUser, nonce: url.searchParams.get("nonce") ?? undefined, redirectUri })
      const back = new URL(redirectUri)
      back.searchParams.set("code", code)
      back.searchParams.set("state", url.searchParams.get("state")!)
      back.searchParams.set("iss", issuer)
      res.writeHead(302, { location: back.toString() }).end()
      return
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = ""
      for await (const chunk of req) body += chunk
      const form = new URLSearchParams(body)
      const entry = codes.get(form.get("code") ?? "")
      if (!entry) return json(400, { error: "invalid_grant" })
      codes.delete(form.get("code")!)
      const accessToken = randomUUID()
      tokens.set(accessToken, entry.user)
      const idToken = await new SignJWT({ ...entry.user, ...(entry.nonce ? { nonce: entry.nonce } : {}) })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(issuer)
        .setAudience(opts.clientId)
        .setSubject(entry.user.sub)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey)
      return json(200, { access_token: accessToken, token_type: "Bearer", expires_in: 300, id_token: idToken, scope: "openid email profile" })
    }
    if (url.pathname === "/userinfo") {
      const user = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""))
      return user ? json(200, user) : json(401, { error: "invalid_token" })
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    issuer,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    /** Who the next /authorize request signs in as. */
    setNextUser: (u: StubUser) => { nextUser = u },
    /** The `redirect_uri` the last /authorize request carried. */
    lastRedirectUri: () => lastRedirectUri,
    close: () => new Promise<void>((r) => server.close(() => r()))
  }
}

export type OidcStub = Awaited<ReturnType<typeof startOidcStub>>
