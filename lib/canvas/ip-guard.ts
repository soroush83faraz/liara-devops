// SSRF helpers: decide whether a resolved address / host name is safe for the server to connect to.
import { isIPv4, isIPv6 } from "node:net";

/** Every IPv4 range that is not ordinary public unicast (RFC 6890 special-purpose registry + multicast). */
function ipv4Private(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // "this network", private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24 IETF, 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, broadcast
  return false;
}

const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** Expand an IPv6 literal to 8 numeric hextets (handles `::` and a trailing dotted IPv4). */
function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * True for every address the server must not connect to: loopback, private, link-local, CGNAT, documentation,
 * benchmarking, multicast, reserved and unspecified - for IPv4, IPv6 and every IPv6 form that embeds an IPv4
 * address (mapped, IPv4-compatible, SIIT-translated, NAT64, 6to4, Teredo). Anything that is not an IP is refused.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIPv4(ip)) return ipv4Private(ip);
  if (!isIPv6(ip)) return true; // not an IP at all: refuse
  const g = expandIPv6(ip);
  if (!g) return true;
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::/96: ::, ::1 and deprecated IPv4-compatible (::7f00:1)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return ipv4Private(embeddedV4(g[6], g[7])); // ::ffff:0:0/96
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:0:0/96 SIIT
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48: can wrap a private v4
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard-only
  if (g[0] === 0x2002) return true; // 2002::/16 6to4: embeds an arbitrary IPv4 (deprecated)
  if (g[0] === 0x2001 && g[1] < 0x0200) return true; // 2001::/23 IETF special purpose, incl. Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x3fff && (g[1] & 0xf000) === 0) return true; // 3fff::/20 documentation (RFC 9637)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

/** A plain public-looking DNS name: no IP literal, no port, no userinfo, has a dot, not a local/internal suffix. */
export function isAllowedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h.length > 253) return false;
  if (isIPv4(h) || isIPv6(h) || h.includes(":") || h.includes("[")) return false;
  if (/^[0-9.]+$/.test(h)) return false; // numeric forms like 2130706433 or 127.1
  const labels = h.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return false;
  const tld = labels[labels.length - 1];
  // Real TLDs start with a letter; "0x7f.1", "127.1" or "017700000001" are inet_aton spellings of an address.
  if (!/^[a-z]/.test(tld)) return false;
  if (["localhost", "local", "internal", "localdomain", "lan", "home", "corp", "test", "invalid", "example", "arpa", "onion"].includes(tld)) return false;
  return true;
}
