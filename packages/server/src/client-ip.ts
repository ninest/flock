// The client IP of a request, from X-Forwarded-For only as far as trusted proxies vouch for it.
// The IP feeds the GeoIP lookup and the cookieless Visitor ID, so a client must not choose it.
import { BlockList, isIP } from "node:net"

/**
 * Which proxies in front of Flock may append to X-Forwarded-For (FLOCK_TRUSTED_PROXIES):
 * - `none`: ignore X-Forwarded-For and use the socket address.
 * - `hops`: this many proxies, each appending one address; the client is that many from the right.
 * - `ranges`: proxies with these addresses; the client is the right-most address outside them.
 */
export type TrustedProxies =
  | { readonly _tag: "none" }
  | { readonly _tag: "hops"; readonly count: number }
  | { readonly _tag: "ranges"; readonly list: BlockList }

/**
 * Parses FLOCK_TRUSTED_PROXIES: empty for none, a hop count such as `1`, or comma-separated
 * CIDRs or addresses such as `10.0.0.0/8, fd00::/8`. Returns an error message when invalid.
 */
export const parseTrustedProxies = (value: string): TrustedProxies | string => {
  const trimmed = value.trim()
  if (trimmed === "" || trimmed === "0") return { _tag: "none" }
  if (/^\d+$/.test(trimmed)) return { _tag: "hops", count: Number(trimmed) }
  const list = new BlockList()
  for (const entry of trimmed.split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    const [address = "", prefix] = entry.split("/")
    const family = isIP(address)
    const bits = prefix === undefined ? (family === 6 ? 128 : 32) : Number(prefix)
    if (family === 0 || !Number.isInteger(bits) || bits < 0 || bits > (family === 6 ? 128 : 32)) {
      return `FLOCK_TRUSTED_PROXIES: "${entry}" is neither a hop count nor an IP address or CIDR range.`
    }
    list.addSubnet(address, bits, family === 6 ? "ipv6" : "ipv4")
  }
  return { _tag: "ranges", list }
}

const isTrusted = (list: BlockList, address: string) => {
  const family = isIP(address)
  return family !== 0 && list.check(address, family === 6 ? "ipv6" : "ipv4")
}

/** The client IP of a request, given its X-Forwarded-For header and socket address. */
export const clientIp = (input: {
  readonly forwardedFor: string | undefined
  readonly socket: string | null
  readonly trusted: TrustedProxies
}): string | null => {
  const { socket, trusted } = input
  if (trusted._tag === "none") return socket
  const forwarded = (input.forwardedFor ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")
  if (trusted._tag === "hops") {
    // Fewer addresses than hops: the left-most one is the furthest any proxy saw.
    return forwarded.length === 0 ? socket : forwarded[Math.max(0, forwarded.length - trusted.count)]!
  }
  const chain = socket === null ? forwarded : [...forwarded, socket]
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isTrusted(trusted.list, chain[i]!)) return chain[i]!
  }
  return chain[0] ?? null
}
