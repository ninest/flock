// Who sent an ingest request: the client's IP address and user agent, read from the HTTP request.
import { Option } from "effect"
import type { HttpServerRequest } from "effect/http/HttpServerRequest"

/** Request context Ingest needs besides the batch itself. The IP is never stored. */
export interface IngestClient {
  /** The client's IP address, or "" when unknown. */
  readonly ip: string
  /** The `User-Agent` header, or "" when absent. */
  readonly userAgent: string
}

/**
 * Flock usually runs behind a reverse proxy (Railway, Caddy, `tailscale serve`) that puts
 * the client's address first in `X-Forwarded-For`, so that wins over the socket address.
 * A client can spoof it, but a client can also send any Event it likes with the public
 * key, so this only lets a sender pick its own Visitor, never read data.
 */
export const ingestClient = (request: HttpServerRequest): IngestClient => {
  const forwarded = request.headers["x-forwarded-for"]?.split(",")[0]?.trim()
  return {
    ip: forwarded || Option.getOrElse(request.remoteAddress, () => ""),
    userAgent: request.headers["user-agent"] ?? ""
  }
}
