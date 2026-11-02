import type { RemoteShell, RemoteShellHandlers } from '../types';

/*
 * A pretend shell on a node, for the mock: echoes what is typed, answers a few
 * commands, and ends on `exit`. Enough to try the terminal without a device.
 */

const ANSWERS: Record<string, (host: string) => string> = {
  'uname -a': (host) => `Linux ${host} 6.1.82 #1 SMP PREEMPT armv7l GNU/Linux`,
  uptime: () => ' 12:04:11 up 3 days,  2:41,  0 users,  load average: 0.21, 0.18, 0.15',
  whoami: () => 'root',
  ls: () => '\x1b[1;34mbin\x1b[0m  \x1b[1;34metc\x1b[0m  \x1b[1;34mhome\x1b[0m  \x1b[1;34mtmp\x1b[0m  \x1b[1;34musr\x1b[0m  \x1b[1;34mvar\x1b[0m',
  hostname: (host) => host,
};

export function createMockShell(host: string, handlers: RemoteShellHandlers): RemoteShell {
  const encoder = new TextEncoder();
  const prompt = `\x1b[1;32mroot@${host}\x1b[0m:~# `;
  let line = '';
  let open = true;
  const out = (text: string) => setTimeout(() => open && handlers.onOutput(encoder.encode(text)), 30);
  setTimeout(() => {
    handlers.onOpen();
    out(`Kaonic OS 1.4.0 (mock)\r\n${prompt}`);
  }, 400);
  const end = (reason: string) => {
    if (!open) return;
    open = false;
    handlers.onClose(reason);
  };
  return {
    write(data) {
      for (const char of data) {
        if (char === '\r') {
          const command = line.trim();
          line = '';
          if (command === 'exit') {
            out('\r\nlogout\r\n');
            setTimeout(() => end('The shell ended.'), 100);
            return;
          }
          const answer = command === '' ? '' : (ANSWERS[command]?.(host) ?? `sh: ${command.split(' ')[0]}: not found in the mock`);
          out(`\r\n${answer ? `${answer}\r\n` : ''}${prompt}`);
        } else if (char === '\x7f') {
          if (line.length > 0) {
            line = line.slice(0, -1);
            out('\b \b');
          }
        } else if (char === '\x03') {
          line = '';
          out(`^C\r\n${prompt}`);
        } else if (char >= ' ') {
          line += char;
          out(char);
        }
      }
    },
    resize() {},
    close() {
      end('Closed.');
    },
  };
}
