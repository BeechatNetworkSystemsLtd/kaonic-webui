import english from './bip39-english.txt?raw';
import type { PhraseLength } from '../types';

/** The BIP39 English list, as the hub has it. */
export const WORDS: readonly string[] = english.trim().split('\n');

async function checksumBits(entropy: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy as BufferSource));
  return Array.from(digest, (byte) => byte.toString(2).padStart(8, '0')).join('').slice(0, entropy.length / 4);
}

async function encode(entropy: Uint8Array): Promise<string[]> {
  const bits = Array.from(entropy, (byte) => byte.toString(2).padStart(8, '0')).join('') + (await checksumBits(entropy));
  return Array.from({ length: bits.length / 11 }, (_, at) => WORDS[parseInt(bits.slice(at * 11, at * 11 + 11), 2)]!);
}

/** A new phrase, as the hub makes one: 128 or 256 random bits and their checksum. */
export function generatePhrase(words: PhraseLength): Promise<string[]> {
  return encode(crypto.getRandomValues(new Uint8Array(words === 12 ? 16 : 32)));
}

/** The hub's message for a phrase it can't use, or null for a good one. */
export async function phraseProblem(text: string): Promise<string | null> {
  const typed = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (typed.length !== 12 && typed.length !== 24) return 'Enter all 12 or 24 words.';
  const unknown = typed.flatMap((word, at) => (WORDS.includes(word) ? [] : [at + 1]));
  if (unknown.length) return `Not on the word list: word ${unknown.join(', ')}.`;
  const bits = typed.map((word) => WORDS.indexOf(word).toString(2).padStart(11, '0')).join('');
  const entropy = new Uint8Array(typed.length * 4 / 3);
  entropy.forEach((_, at) => (entropy[at] = parseInt(bits.slice(at * 8, at * 8 + 8), 2)));
  const again = await encode(entropy);
  return again.join(' ') === typed.join(' ') ? null : 'These words do not fit together: one is mistyped or out of order.';
}

/** The words as the hub derives from them. */
export const normalisePhrase = (text: string) => text.trim().toLowerCase().split(/\s+/).join(' ');
