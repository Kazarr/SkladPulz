/**
 * Prints the hash of a manager's password for `managers[].passwordHash` in config.json.
 *
 *   npm run hash-password                (reads the password from standard input, so it stays out of the shell history)
 *   npm run hash-password -- <password>
 *
 * Hash format: see src/auth.ts.
 */
import { hashPassword } from '../auth.ts';

async function readStdin(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text.replace(/\r?\n$/, '');
}

const password = process.argv[2] ?? (await readStdin());
if (password === '') {
  console.error('Zadajte heslo ako argument alebo cez štandardný vstup.');
  process.exit(1);
}
console.log(hashPassword(password));
