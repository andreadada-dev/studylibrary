import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const directory = new URL('../supabase/migrations/', import.meta.url);
const files = (await readdir(directory))
  .filter(name => name.endsWith('.sql'))
  .sort();

let failed = false;

for (const file of files) {
  const source = await readFile(new URL(file, directory), 'utf8');
  const result = lexicalCheck(source);

  if (result.ok) {
    console.log('SQL lexical check OK:', file);
  } else {
    failed = true;
    console.error('SQL lexical check FAILED:', file);
    for (const error of result.errors) console.error('  - ' + error);
  }
}

if (failed) process.exit(1);

function lexicalCheck(source) {
  const errors = [];
  const stack = [];
  let i = 0;
  let line = 1;
  let state = 'normal';
  let dollarTag = '';

  const advance = char => {
    if (char === '\n') line += 1;
    i += 1;
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (state === 'line-comment') {
      advance(char);
      if (char === '\n') state = 'normal';
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        advance(char);
        advance(next);
        state = 'normal';
      } else {
        advance(char);
      }
      continue;
    }

    if (state === 'single-quote') {
      if (char === "'" && next === "'") {
        advance(char);
        advance(next);
        continue;
      }
      if (char === "'") {
        advance(char);
        state = 'normal';
        continue;
      }
      advance(char);
      continue;
    }

    if (state === 'dollar-quote') {
      if (source.startsWith(dollarTag, i)) {
        for (let count = 0; count < dollarTag.length; count += 1) advance(source[i]);
        state = 'normal';
        dollarTag = '';
      } else {
        advance(char);
      }
      continue;
    }

    if (char === '-' && next === '-') {
      advance(char);
      advance(next);
      state = 'line-comment';
      continue;
    }

    if (char === '/' && next === '*') {
      advance(char);
      advance(next);
      state = 'block-comment';
      continue;
    }

    if (char === "'") {
      advance(char);
      state = 'single-quote';
      continue;
    }

    if (char === '

    if (char === '(' || char === '[') {
      stack.push({ char, line });
    } else if (char === ')' || char === ']') {
      const expected = char === ')' ? '(' : '[';
      const open = stack.pop();
      if (!open || open.char !== expected) {
        errors.push('Unbalanced ' + char + ' at line ' + line);
      }
    }

    advance(char);
  }

  if (state === 'single-quote') errors.push('Unterminated single-quoted string near line ' + line);
  if (state === 'dollar-quote') errors.push('Unterminated dollar quote ' + dollarTag + ' near line ' + line);
  if (state === 'block-comment') errors.push('Unterminated block comment near line ' + line);

  for (const open of stack.reverse()) {
    errors.push('Unclosed ' + open.char + ' opened at line ' + open.line);
  }

  return { ok: errors.length === 0, errors };
}
) {
      const match = source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        for (let count = 0; count < dollarTag.length; count += 1) advance(source[i]);
        state = 'dollar-quote';
        continue;
      }

      const prev = source[i - 1] || '';
      const after = source[i + 1] || '';
      if (/\s/.test(prev) || /[;\s]/.test(after) || i === 0) {
        errors.push('Suspicious naked $ at line ' + line + '; PostgreSQL dollar quotes must be $ or $tag

    if (char === '(' || char === '[') {
      stack.push({ char, line });
    } else if (char === ')' || char === ']') {
      const expected = char === ')' ? '(' : '[';
      const open = stack.pop();
      if (!open || open.char !== expected) {
        errors.push('Unbalanced ' + char + ' at line ' + line);
      }
    }

    advance(char);
  }

  if (state === 'single-quote') errors.push('Unterminated single-quoted string near line ' + line);
  if (state === 'dollar-quote') errors.push('Unterminated dollar quote ' + dollarTag + ' near line ' + line);
  if (state === 'block-comment') errors.push('Unterminated block comment near line ' + line);

  for (const open of stack.reverse()) {
    errors.push('Unclosed ' + open.char + ' opened at line ' + open.line);
  }

  return { ok: errors.length === 0, errors };
}
);
      }
    }

    if (char === '(' || char === '[') {
      stack.push({ char, line });
    } else if (char === ')' || char === ']') {
      const expected = char === ')' ? '(' : '[';
      const open = stack.pop();
      if (!open || open.char !== expected) {
        errors.push('Unbalanced ' + char + ' at line ' + line);
      }
    }

    advance(char);
  }

  if (state === 'single-quote') errors.push('Unterminated single-quoted string near line ' + line);
  if (state === 'dollar-quote') errors.push('Unterminated dollar quote ' + dollarTag + ' near line ' + line);
  if (state === 'block-comment') errors.push('Unterminated block comment near line ' + line);

  for (const open of stack.reverse()) {
    errors.push('Unclosed ' + open.char + ' opened at line ' + open.line);
  }

  return { ok: errors.length === 0, errors };
}
