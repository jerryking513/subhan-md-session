// restore-session.js
// Use this inside SUBHAN MD (or any Baileys bot) to turn the base64
// session string from the pairing site back into a real auth folder,
// so the bot can connect without scanning or pairing again.
//
// Usage:
//   1. Set SESSION_ID as an environment variable on your bot host
//      (Railway, VPS, etc.) with the string you copied from the site.
//   2. Call restoreSession() once, before useMultiFileAuthState().
//
// Example:
//   import { restoreSession } from './restore-session.js';
//   import { useMultiFileAuthState } from '@whiskeysockets/baileys';
//
//   restoreSession(process.env.SESSION_ID, './auth');
//   const { state, saveCreds } = await useMultiFileAuthState('./auth');

import fs from 'fs';
import path from 'path';

export function restoreSession(sessionString, authFolder = './auth') {
  if (!sessionString) {
    throw new Error('SESSION_ID is missing. Set it as an environment variable.');
  }

  const PREFIX = 'SUBHAN-MD~';
  const raw = sessionString.startsWith(PREFIX)
    ? sessionString.slice(PREFIX.length)
    : sessionString;

  const bundle = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));

  fs.mkdirSync(authFolder, { recursive: true });
  for (const [filename, contents] of Object.entries(bundle)) {
    fs.writeFileSync(path.join(authFolder, filename), contents, 'utf8');
  }

  console.log(`Session restored into ${authFolder}`);
}
