import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/ui';
import styles from './Auth.module.css';

/** The phrase as text: one numbered word per line, as saved to a file. */
export function phraseText(words: readonly string[]): string {
  return words.map((word, at) => `${String(at + 1).padStart(2, ' ')}. ${word}`).join('\n');
}

/** The words the device made, numbered, with ways to keep them. */
export function PhraseCard({ words, codename }: { words: readonly string[]; codename: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(words.join(' '));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (a page not served securely): the words stay on screen to write down.
    }
  }

  function save() {
    const text = `Kaonic Admin seed phrase (${codename})\nKeep it private and apart from the device.\n\n${phraseText(words)}\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = `kaonic-admin-${codename}-seed-phrase.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className={styles.phraseCard}>
      <ol className={styles.phrase} aria-label="Seed phrase">
        {words.map((word, at) => (
          <li key={at} className={styles.word}>
            <span className={styles.wordNumber}>{at + 1}</span>
            <span className="mono">{word}</span>
          </li>
        ))}
      </ol>
      <div className={styles.phraseActions}>
        <Button size="small" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="small" onClick={save}>
          <Download /> Save as file
        </Button>
      </div>
    </div>
  );
}

interface PhraseInputProps {
  /** One entry per box; its length is the number of words asked for. */
  words: string[];
  onChange: (words: string[]) => void;
  /** Which positions (0-based) to ask for; all by default. */
  positions?: readonly number[];
  /** The valid words, for suggestions and marking a word off the list. */
  wordlist?: readonly string[];
  autoFocus?: boolean;
}

/** Numbered boxes to type a phrase in, one word each. Pasting the whole phrase fills them all. */
export function PhraseInput({ words, onChange, positions, wordlist, autoFocus }: PhraseInputProps) {
  const listId = useId();
  const asked = positions ?? words.map((_, at) => at);
  const known = wordlist ? new Set(wordlist) : null;

  const focus = (at: number) => document.getElementById(`${listId}-${at}`)?.focus();

  function set(at: number, value: string) {
    const next = [...words];
    next[at] = value.trim().toLowerCase();
    onChange(next);
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>, from: number) {
    const pasted = event.clipboardData.getData('text').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (pasted.length < 2) return;
    event.preventDefault();
    const next = [...words];
    const start = asked.indexOf(from);
    pasted.slice(0, asked.length - start).forEach((word, offset) => (next[asked[start + offset]!] = word));
    onChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, from: number) {
    if (event.key !== ' ') return;
    event.preventDefault();
    const after = asked[asked.indexOf(from) + 1];
    if (after !== undefined) focus(after);
  }

  return (
    <>
      <ol className={styles.phrase} aria-label="Seed phrase">
        {asked.map((at, index) => {
          const word = words[at] ?? '';
          const off = known !== null && word.length > 0 && !known.has(word);
          return (
            <li key={at} className={styles.word}>
              <label className={styles.wordNumber} htmlFor={`${listId}-${at}`}>
                {at + 1}
              </label>
              <input
                id={`${listId}-${at}`}
                className={`${styles.wordInput} mono`}
                list={known ? listId : undefined}
                autoFocus={autoFocus && index === 0}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Word ${at + 1}`}
                aria-invalid={off || undefined}
                value={word}
                onChange={(event) => set(at, event.target.value)}
                onPaste={(event) => onPaste(event, at)}
                onKeyDown={(event) => onKeyDown(event, at)}
              />
            </li>
          );
        })}
      </ol>
      {wordlist ? (
        <datalist id={listId}>
          {wordlist.map((word) => (
            <option key={word} value={word} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

/** `count` distinct positions out of `length`, in order, for checking the words were kept. */
export function pickPositions(length: number, count: number): number[] {
  const picked = new Set<number>();
  while (picked.size < Math.min(count, length)) {
    for (const value of crypto.getRandomValues(new Uint32Array(count))) {
      if (picked.size < count) picked.add(value % length);
    }
  }
  return [...picked].sort((a, b) => a - b);
}
