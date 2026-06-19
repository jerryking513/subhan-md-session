import { webcrypto } from 'node:crypto';

// Baileys' newer internals call the Web Crypto API (globalThis.crypto)
// directly. That global is only built into Node by default from v20+; on
// Node 18 it's missing unless polyfilled, which is what caused the
// "crypto is not defined" crash. This makes it available everywhere,
// including older Node runtimes some hosts still default to.
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import pino from 'pino';
import baileysPkg from '@whiskeysockets/baileys';

// @whiskeysockets/baileys is a CommonJS package. Some of its exports (like
// `proto`) are attached via a barrel `export *` re-export, which Node's
// static CJS->ESM analyzer can't always see — causing
// "Named export 'proto' not found" crashes. Importing the whole module as
// default and destructuring at runtime sidesteps that entirely.
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  delay,
  generateWAMessageFromContent,
  proto,
} = baileysPkg;

const SESSION_PREFIX = 'SUBHAN-MD~';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete linking

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// id -> { sock, status, code, sessionString, error, timeoutHandle }
const sessions = new Map();

function cleanupSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
  try { s.sock?.end(undefined); } catch (_) {}
  try { s.sock?.ws?.close(); } catch (_) {}
  const dir = path.join(SESSIONS_DIR, id);
  fs.rm(dir, { recursive: true, force: true }, () => {});
  sessions.delete(id);
}

// Bundles every file Baileys wrote into the auth folder (creds.json + any
// app-state-sync key files) into one base64 string. This string is what the
// user later decodes inside their own bot to restore the linked session,
// without needing to re-scan or re-pair.
function encodeSessionFolder(dir) {
  const files = fs.readdirSync(dir);
  const bundle = {};
  for (const f of files) {
    bundle[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return Buffer.from(JSON.stringify(bundle)).toString('base64');
}

// Sends a self-DM to the just-linked number with a native "Copy" button
// holding the session ID — same pattern used by most MD-style WA bots.
async function sendSessionToSelf(sock, sessionId) {
  const jid = sock.user?.id;
  if (!jid) return;

  const message = generateWAMessageFromContent(
    jid,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: proto.Message.InteractiveMessage.create({
            header: proto.Message.InteractiveMessage.Header.create({
              title: 'Your Session ID Is 👇',
              hasMediaAttachment: false,
            }),
            body: proto.Message.InteractiveMessage.Body.create({
              text: 'Thanks For Connecting ✅',
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: 'SUBHAN MD',
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
              buttons: [
                {
                  name: 'cta_copy',
                  buttonParamsJson: JSON.stringify({
                    display_text: 'Copy Session ID',
                    id: 'copy_session_id',
                    copy_code: sessionId,
                  }),
                },
              ],
            }),
          }),
        },
      },
    },
    {}
  );

  await sock.relayMessage(jid, message.message, { messageId: message.key.id });
}

app.post('/api/pair', async (req, res) => {
  try {
    let { number } = req.body || {};
    if (!number) return res.status(400).json({ error: 'Phone number is required' });

    number = String(number).replace(/[^0-9]/g, '');
    if (number.length < 7) {
      return res.status(400).json({ error: 'Enter number with country code, digits only (e.g. 923001234567)' });
    }

    const id = crypto.randomUUID();
    const sessionPath = path.join(SESSIONS_DIR, id);
    fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.macOS('Safari'),
      logger: pino({ level: 'silent' }),
    });

    const sessionData = {
      sock,
      status: 'pairing',
      code: null,
      sessionString: null,
      error: null,
    };
    sessions.set(id, sessionData);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection } = update;
      const s = sessions.get(id);
      if (!s) return;

      if (connection === 'open') {
        s.status = 'connected';
        try {
          s.sessionString = SESSION_PREFIX + encodeSessionFolder(sessionPath);
        } catch (e) {
          s.status = 'failed';
          s.error = 'Linked, but failed to read session files.';
        }

        if (s.sessionString) {
          try {
            await delay(2000); // let WA register the new device before messaging
            await sendSessionToSelf(sock, s.sessionString);
          } catch (e) {
            console.error('Self-DM failed:', e?.message || e);
            // Not fatal — the session string is still shown on the site.
          }
        }

        setTimeout(() => { try { sock.end(undefined); } catch (_) {} }, 1500);
      }

      if (connection === 'close' && s.status === 'pairing') {
        s.status = 'failed';
        s.error = 'Connection closed before linking finished. Try again.';
      }
    });

    if (!sock.authState.creds.registered) {
      await delay(1500); // small delay improves pairing-code reliability
      const code = await sock.requestPairingCode(number);
      sessionData.code = code;
    }

    sessionData.timeoutHandle = setTimeout(() => {
      const s = sessions.get(id);
      if (s && s.status !== 'connected') cleanupSession(id);
    }, SESSION_TTL_MS);

    res.json({ sessionId: id, code: sessionData.code });
  } catch (err) {
    console.error('Pairing error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate pairing code' });
  }
});

app.get('/api/status/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ status: 'expired' });
  res.json({
    status: s.status,
    code: s.code,
    sessionString: s.status === 'connected' ? s.sessionString : undefined,
    error: s.error || undefined,
  });
});

app.post('/api/cleanup/:id', (req, res) => {
  cleanupSession(req.params.id);
  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`SUBHAN MD pairing server running on port ${PORT}`);
});
