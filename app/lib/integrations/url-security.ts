import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
  "instance-data",
  "instance-data.ec2.internal",
]);

type ResolvedAddress = { address: string; family: number };
export type WebhookDnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export class UnsafeWebhookUrlError extends Error {
  readonly code = "unsafe_webhook_url";

  constructor() {
    super("Webhook URL is not an allowed public HTTPS destination.");
  }
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv6Number(address: string): bigint | null {
  let source = address;
  const ipv4Tail = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Tail) {
    const ipv4 = ipv4Number(ipv4Tail);
    if (ipv4 === null) return null;
    source = `${source.slice(0, -ipv4Tail.length)}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.reduce((value, group) => (value << BigInt(16)) | BigInt(parseInt(group, 16)), BigInt(0));
}

function inIpv6Range(value: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (base >> shift);
}

export function isForbiddenNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const value = ipv4Number(normalized);
    if (value === null) return true;
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    return blocked.some(([base, prefix]) => inIpv4Range(value, ipv4Number(base)!, prefix));
  }

  if (ipVersion === 6) {
    const value = ipv6Number(normalized);
    if (value === null) return true;
    const zero = BigInt(0);
    const mappedIpv4Base = ipv6Number("::ffff:0:0")!;
    if (value === zero || value === BigInt(1)) return true; // unspecified + loopback
    if (inIpv6Range(value, zero, 96)) return true; // deprecated IPv4-compatible range
    if (inIpv6Range(value, ipv6Number("64:ff9b::")!, 96)) return true; // NAT64 well-known prefix
    if (inIpv6Range(value, ipv6Number("100::")!, 64)) return true; // discard-only
    if (inIpv6Range(value, ipv6Number("2001:db8::")!, 32)) return true; // documentation
    if (inIpv6Range(value, ipv6Number("fc00::")!, 7)) return true; // unique local
    if (inIpv6Range(value, ipv6Number("fe80::")!, 10)) return true; // link-local
    if (inIpv6Range(value, ipv6Number("ff00::")!, 8)) return true; // multicast
    if (inIpv6Range(value, mappedIpv4Base, 96)) {
      const mapped = Number(value & BigInt("0xffffffff"));
      return isForbiddenNetworkAddress(`${(mapped >>> 24) & 255}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`);
    }
    return false;
  }

  return true;
}

const defaultResolver: WebhookDnsResolver = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export async function validateWebhookUrl(
  value: string,
  options: { resolver?: WebhookDnsResolver; allowHttpForIsolatedTests?: boolean } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeWebhookUrlError();
  }

  const allowHttp = options.allowHttpForIsolatedTests === true && process.env.NODE_ENV === "test";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) throw new UnsafeWebhookUrlError();
  if (url.username || url.password) throw new UnsafeWebhookUrlError();

  const urlHostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const hostname = urlHostname.startsWith("[") && urlHostname.endsWith("]") ? urlHostname.slice(1, -1) : urlHostname;
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) throw new UnsafeWebhookUrlError();
  if (isIP(hostname) && isForbiddenNetworkAddress(hostname)) throw new UnsafeWebhookUrlError();

  let addresses: ResolvedAddress[];
  try {
    addresses = await (options.resolver ?? defaultResolver)(hostname);
  } catch {
    throw new UnsafeWebhookUrlError();
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isForbiddenNetworkAddress(address))) {
    throw new UnsafeWebhookUrlError();
  }

  return url;
}
