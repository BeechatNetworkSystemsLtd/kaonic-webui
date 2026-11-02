import type { Summary } from './dissect';

/*
 * A small display-filter language in Wireshark's style:
 *
 *   tcp && tcp.port == 443          ip.addr == 10.77.0.0/16
 *   !(udp.port == 53) || icmp       tcp.flags.syn == 1 and not tcp.flags.ack
 *   node == emunode1                 verdict == dropped
 *
 * Fields are compared with == != < <= > >=; a field on its own is true when the
 * packet has it and it is not zero. `and`, `or`, `not` work like && || !.
 */

/** What a filter looks at for one packet. */
export interface FilterRecord {
  summary: Summary;
  number: number;
  len: number;
  capturedLen: number;
  node: string;
  direction: 'rx' | 'tx';
  verdict: string;
  reason: string | null;
}

type Value = number | string | { network: number; mask: number } | boolean;

type Node =
  | { kind: 'and' | 'or'; left: Node; right: Node }
  | { kind: 'not'; inner: Node }
  | { kind: 'test'; field: string }
  | { kind: 'compare'; field: string; op: Op; value: Value; text: string };

type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'contains';

export class FilterError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
  }
}

export interface Filter {
  test(record: FilterRecord): boolean;
}

/* ── fields ── */

type FieldKind = 'number' | 'address' | 'string' | 'bool' | 'protocol';

interface FieldDef {
  kind: FieldKind;
  /** The values in a packet; several for `ip.addr`, `tcp.port`; none when absent. */
  get: (r: FilterRecord) => Array<number | string | boolean>;
}

const ipToNumber = (text: string) => text.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const tcpOf = (r: FilterRecord) => r.summary.tcp;
const udpOf = (r: FilterRecord) => r.summary.udp;
const flag = (bit: number) => (r: FilterRecord) => (tcpOf(r) ? [(tcpOf(r)!.flags & bit) !== 0] : []);

const FIELDS: Record<string, FieldDef> = {
  ip: { kind: 'protocol', get: (r) => [r.summary.ipv4] },
  tcp: { kind: 'protocol', get: (r) => [r.summary.tcp !== null] },
  udp: { kind: 'protocol', get: (r) => [r.summary.udp !== null] },
  icmp: { kind: 'protocol', get: (r) => [r.summary.icmp !== null] },
  dns: { kind: 'protocol', get: (r) => [r.summary.dns !== null] },
  igmp: { kind: 'protocol', get: (r) => [r.summary.protoNumber === 2] },
  'ip.addr': { kind: 'address', get: (r) => (r.summary.ipv4 ? [r.summary.src, r.summary.dst] : []) },
  'ip.src': { kind: 'address', get: (r) => (r.summary.ipv4 ? [r.summary.src] : []) },
  'ip.dst': { kind: 'address', get: (r) => (r.summary.ipv4 ? [r.summary.dst] : []) },
  'ip.proto': { kind: 'number', get: (r) => (r.summary.protoNumber !== null ? [r.summary.protoNumber] : []) },
  'ip.ttl': { kind: 'number', get: (r) => (r.summary.ttl !== null ? [r.summary.ttl] : []) },
  'ip.len': { kind: 'number', get: (r) => (r.summary.totalLength !== null ? [r.summary.totalLength] : []) },
  'ip.id': { kind: 'number', get: (r) => (r.summary.ipId !== null ? [r.summary.ipId] : []) },
  'ip.flags.df': { kind: 'bool', get: (r) => (r.summary.ipv4 ? [r.summary.df] : []) },
  'ip.flags.mf': { kind: 'bool', get: (r) => (r.summary.ipv4 ? [r.summary.mf] : []) },
  'ip.frag_offset': { kind: 'number', get: (r) => (r.summary.ipv4 ? [r.summary.fragmentOffset] : []) },
  'tcp.port': { kind: 'number', get: (r) => (tcpOf(r) ? [tcpOf(r)!.srcPort, tcpOf(r)!.dstPort] : []) },
  'tcp.srcport': { kind: 'number', get: (r) => (tcpOf(r) ? [tcpOf(r)!.srcPort] : []) },
  'tcp.dstport': { kind: 'number', get: (r) => (tcpOf(r) ? [tcpOf(r)!.dstPort] : []) },
  'tcp.len': { kind: 'number', get: (r) => (tcpOf(r) ? [tcpOf(r)!.payloadLen] : []) },
  'tcp.window_size': { kind: 'number', get: (r) => (tcpOf(r) ? [tcpOf(r)!.window] : []) },
  'tcp.flags': { kind: 'number', get: (r) => (tcpOf(r) ? [tcpOf(r)!.flags] : []) },
  'tcp.flags.fin': { kind: 'bool', get: flag(0x01) },
  'tcp.flags.syn': { kind: 'bool', get: flag(0x02) },
  'tcp.flags.reset': { kind: 'bool', get: flag(0x04) },
  'tcp.flags.rst': { kind: 'bool', get: flag(0x04) },
  'tcp.flags.push': { kind: 'bool', get: flag(0x08) },
  'tcp.flags.psh': { kind: 'bool', get: flag(0x08) },
  'tcp.flags.ack': { kind: 'bool', get: flag(0x10) },
  'tcp.flags.urg': { kind: 'bool', get: flag(0x20) },
  'udp.port': { kind: 'number', get: (r) => (udpOf(r) ? [udpOf(r)!.srcPort, udpOf(r)!.dstPort] : []) },
  'udp.srcport': { kind: 'number', get: (r) => (udpOf(r) ? [udpOf(r)!.srcPort] : []) },
  'udp.dstport': { kind: 'number', get: (r) => (udpOf(r) ? [udpOf(r)!.dstPort] : []) },
  'udp.length': { kind: 'number', get: (r) => (udpOf(r) ? [udpOf(r)!.length] : []) },
  'icmp.type': { kind: 'number', get: (r) => (r.summary.icmp ? [r.summary.icmp.type] : []) },
  'icmp.code': { kind: 'number', get: (r) => (r.summary.icmp ? [r.summary.icmp.code] : []) },
  'dns.id': { kind: 'number', get: (r) => (r.summary.dns ? [r.summary.dns.id] : []) },
  'dns.flags.response': { kind: 'bool', get: (r) => (r.summary.dns ? [r.summary.dns.response] : []) },
  'dns.qry.name': { kind: 'string', get: (r) => r.summary.dns?.names ?? [] },
  'frame.number': { kind: 'number', get: (r) => [r.number] },
  'frame.len': { kind: 'number', get: (r) => [r.len] },
  'frame.cap_len': { kind: 'number', get: (r) => [r.capturedLen] },
  node: { kind: 'string', get: (r) => [r.node] },
  dir: { kind: 'string', get: (r) => [r.direction] },
  verdict: { kind: 'string', get: (r) => [r.verdict] },
  reason: { kind: 'string', get: (r) => (r.reason ? [r.reason] : []) },
};

/** Field names, for hints and autocompletion. */
export const FILTER_FIELDS = Object.keys(FIELDS);

/* ── tokens ── */

type Token = { kind: 'word' | 'op' | 'string' | 'lparen' | 'rparen' | 'and' | 'or' | 'not'; text: string; position: number };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const start = i;
    if (c === '(' || c === ')') {
      tokens.push({ kind: c === '(' ? 'lparen' : 'rparen', text: c, position: start });
      i += 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      tokens.push({ kind: two === '&&' ? 'and' : 'or', text: two, position: start });
      i += 2;
      continue;
    }
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      tokens.push({ kind: 'op', text: two, position: start });
      i += 2;
      continue;
    }
    if (c === '<' || c === '>') {
      tokens.push({ kind: 'op', text: c, position: start });
      i += 1;
      continue;
    }
    if (c === '!') {
      tokens.push({ kind: 'not', text: c, position: start });
      i += 1;
      continue;
    }
    if (c === '"') {
      const end = input.indexOf('"', i + 1);
      if (end < 0) throw new FilterError('This quote is never closed.', start);
      tokens.push({ kind: 'string', text: input.slice(i + 1, end), position: start });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z0-9_.:/-]/.test(c)) {
      while (i < input.length && /[A-Za-z0-9_.:/-]/.test(input[i]!)) i += 1;
      const word = input.slice(start, i);
      const lower = word.toLowerCase();
      if (lower === 'and' || lower === 'or' || lower === 'not') tokens.push({ kind: lower, text: word, position: start });
      else if (lower === 'eq' || lower === 'ne' || lower === 'lt' || lower === 'le' || lower === 'gt' || lower === 'ge' || lower === 'contains') {
        const map: Record<string, Op> = { eq: '==', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=', contains: 'contains' };
        tokens.push({ kind: 'op', text: map[lower]!, position: start });
      } else tokens.push({ kind: 'word', text: word, position: start });
      continue;
    }
    throw new FilterError(`"${c}" is not expected here.`, start);
  }
  return tokens;
}

/* ── parser ── */

function parseValue(field: string, def: FieldDef, token: Token): Value {
  const text = token.text;
  switch (def.kind) {
    case 'number':
    case 'bool': {
      if (def.kind === 'bool' && (text === 'true' || text === 'false')) return text === 'true' ? 1 : 0;
      const n = /^0x[0-9a-f]+$/i.test(text) ? parseInt(text, 16) : /^\d+$/.test(text) ? Number(text) : NaN;
      if (Number.isNaN(n)) throw new FilterError(`"${text}" is not a number, which ${field} needs.`, token.position);
      return n;
    }
    case 'address': {
      const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(text);
      if (!match || match.slice(1, 5).some((part) => Number(part) > 255) || (match[5] !== undefined && Number(match[5]) > 32)) {
        throw new FilterError(`"${text}" is not an IPv4 address (like 10.77.1.2 or 10.77.0.0/16).`, token.position);
      }
      const bits = match[5] === undefined ? 32 : Number(match[5]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return { network: (ipToNumber(match.slice(1, 5).join('.')) & mask) >>> 0, mask };
    }
    case 'string':
      return text;
    case 'protocol':
      throw new FilterError(`${field} is a protocol: use it on its own, like "${field}" or "!${field}".`, token.position);
  }
}

function parse(tokens: Token[], inputLength: number): Node {
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];

  const parseOr = (): Node => {
    let left = parseAnd();
    while (peek()?.kind === 'or') {
      next();
      left = { kind: 'or', left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): Node => {
    let left = parseUnary();
    while (peek()?.kind === 'and') {
      next();
      left = { kind: 'and', left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): Node => {
    if (peek()?.kind === 'not') {
      next();
      return { kind: 'not', inner: parseUnary() };
    }
    return parsePrimary();
  };
  const parsePrimary = (): Node => {
    const token = next();
    if (!token) throw new FilterError('The filter ends too early: a field or "(" should follow.', inputLength);
    if (token.kind === 'lparen') {
      const inner = parseOr();
      const close = next();
      if (close?.kind !== 'rparen') throw new FilterError('A "(" is never closed.', close?.position ?? inputLength);
      return inner;
    }
    if (token.kind !== 'word') throw new FilterError(`"${token.text}" is not expected here: a field should come first.`, token.position);
    const def = FIELDS[token.text.toLowerCase()];
    if (!def) throw new FilterError(`"${token.text}" is not a field this filter knows (try ip.addr, tcp.port, udp, dns, node…).`, token.position);
    const field = token.text.toLowerCase();
    if (peek()?.kind !== 'op') return { kind: 'test', field };
    const op = next()!.text as Op;
    const valueToken = next();
    if (!valueToken || (valueToken.kind !== 'word' && valueToken.kind !== 'string')) {
      throw new FilterError(`A value should follow "${op}".`, valueToken?.position ?? inputLength);
    }
    if (op === 'contains' && def.kind !== 'string') throw new FilterError(`"contains" works on text fields, not ${field}.`, valueToken.position);
    if ((op === '<' || op === '<=' || op === '>' || op === '>=') && def.kind !== 'number') {
      throw new FilterError(`"${op}" compares numbers; ${field} is not one.`, valueToken.position);
    }
    return { kind: 'compare', field, op, value: parseValue(field, def, valueToken), text: valueToken.text };
  };

  const node = parseOr();
  const rest = peek();
  if (rest) throw new FilterError(`"${rest.text}" is not expected here (missing && or ||?).`, rest.position);
  return node;
}

/* ── evaluation ── */

function matches(def: FieldDef, value: number | string | boolean, op: Op, wanted: Value): boolean {
  if (def.kind === 'address' && typeof value === 'string' && typeof wanted === 'object') {
    return ((ipToNumber(value) & wanted.mask) >>> 0) === wanted.network;
  }
  if (def.kind === 'string') {
    const a = String(value).toLowerCase();
    const b = String(wanted).toLowerCase();
    return op === 'contains' ? a.includes(b) : a === b;
  }
  const a = typeof value === 'boolean' ? Number(value) : Number(value);
  const b = Number(wanted);
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    default:
      return a === b;
  }
}

function evaluate(node: Node, record: FilterRecord): boolean {
  switch (node.kind) {
    case 'and':
      return evaluate(node.left, record) && evaluate(node.right, record);
    case 'or':
      return evaluate(node.left, record) || evaluate(node.right, record);
    case 'not':
      return !evaluate(node.inner, record);
    case 'test': {
      const values = FIELDS[node.field]!.get(record);
      return values.some((value) => value !== false && value !== 0 && value !== '');
    }
    case 'compare': {
      const def = FIELDS[node.field]!;
      const values = def.get(record);
      // Like Wireshark's !=: true when no value of the field equals it (and the field is present).
      if (node.op === '!=') return values.length > 0 && !values.some((value) => matches(def, value, '==', node.value));
      return values.some((value) => matches(def, value, node.op, node.value));
    }
  }
}

/** Parses a display filter; an empty one lets every packet through. Throws FilterError. */
export function compileFilter(input: string): Filter {
  if (input.trim() === '') return { test: () => true };
  const node = parse(tokenize(input), input.length);
  return { test: (record) => evaluate(node, record) };
}

/** Whether `input` parses, and why not. */
export function checkFilter(input: string): { ok: true } | { ok: false; message: string; position: number } {
  try {
    compileFilter(input);
    return { ok: true };
  } catch (error) {
    if (error instanceof FilterError) return { ok: false, message: error.message, position: error.position };
    throw error;
  }
}
