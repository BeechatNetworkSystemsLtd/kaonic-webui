import type { VpnGatewayInput, VpnSharePatch, VpnUplinkInput } from './types';

/**
 * Checks for the VPN sharing forms, the same the hub makes: the page shows them before
 * sending, and the mock answers with them.
 */

export type FieldErrors = Record<string, string>;

/** A dotted IPv4 address, each part 0..255. */
export function isIpv4(text: string): boolean {
  const parts = text.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** An IPv4 prefix like 192.168.10.0/24. */
export function isCidr(text: string): boolean {
  const [address, length, ...rest] = text.split('/');
  return rest.length === 0 && address !== undefined && length !== undefined && isIpv4(address) && /^\d{1,2}$/.test(length) && Number(length) <= 32;
}

/** Prefix length of a valid prefix. */
const prefixLength = (cidr: string) => Number(cidr.split('/')[1]);

/** A list typed as text: separated by commas, spaces or new lines. */
export function parseList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const INTERFACE = /^[A-Za-z0-9_.-]{1,15}$/;
const HASH = /^[0-9a-f]{32}$/;

function checkPrefixes(list: string[], field: string, errors: FieldErrors) {
  if (list.length > 32) errors[field] = 'At most 32 prefixes.';
  const bad = list.find((item) => !isCidr(item));
  if (bad !== undefined) errors[field] = `${bad} is not a prefix like 192.168.10.0/24.`;
}

export function checkSharePatch(patch: VpnSharePatch): FieldErrors {
  const errors: FieldErrors = {};
  if (patch.lanInterfaces && (patch.lanInterfaces.length > 8 || !patch.lanInterfaces.every((name) => INTERFACE.test(name)))) {
    errors.lanInterfaces = 'Up to 8 interface names (letters, digits, _ . -).';
  }
  if (patch.mappingPool !== undefined) {
    if (!isCidr(patch.mappingPool)) errors.mappingPool = 'A prefix like 10.78.0.0/16.';
    else if (prefixLength(patch.mappingPool) < 8 || prefixLength(patch.mappingPool) > 24) errors.mappingPool = 'Use a /8 to /24.';
  }
  if (patch.dnsServers) {
    if (patch.dnsServers.length > 4) errors.dnsServers = 'At most 4.';
    const bad = patch.dnsServers.find((server) => !isIpv4(server));
    if (bad !== undefined) errors.dnsServers = `${bad} is not an IPv4 address.`;
  }
  return errors;
}

export function checkAdvertised(advertised: string[]): FieldErrors {
  const errors: FieldErrors = {};
  checkPrefixes(advertised, 'advertised', errors);
  return errors;
}

export function checkUplink(input: VpnUplinkInput): FieldErrors {
  const errors: FieldErrors = {};
  if (input.peerId !== null && !HASH.test(input.peerId)) errors.peerId = "A node's identity hash (32 hex digits).";
  checkPrefixes(input.routes, 'routes', errors);
  if (input.enabled && !input.defaultRoute && input.routes.length === 0 && !errors.routes) {
    errors.routes = 'Name the destinations to send to the gateway, or send everything.';
  }
  return errors;
}

export function checkGateway(input: VpnGatewayInput): FieldErrors {
  const errors: FieldErrors = {};
  if (input.egressInterface !== null && !INTERFACE.test(input.egressInterface)) errors.egressInterface = 'An interface name.';
  checkPrefixes(input.routes, 'routes', errors);
  if (input.enabled && input.routes.length === 0 && !errors.routes) errors.routes = 'Name the destinations to forward (0.0.0.0/0 for everything).';
  return errors;
}
