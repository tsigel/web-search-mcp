import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a = 0, b = 0] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8")
    || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

function isDnsProxyAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 198 && (b === 18 || b === 19);
  }
  return normalized === "2001:2::" || normalized.startsWith("2001:2:");
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("Only ports 80 and 443 are allowed");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local hostnames are not allowed");
  }
  const literalVersion = isIP(hostname);
  if (literalVersion && isPrivateAddress(hostname)) throw new Error("Private network addresses are not allowed");
  if (!literalVersion) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0
      || addresses.some(({ address }) => isPrivateAddress(address) && !isDnsProxyAddress(address))) {
      throw new Error("URL resolves to a private or unavailable address");
    }
  }
  url.hash = "";
  return url;
}
