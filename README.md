# SUBHAN MD — Pairing Code Generator

Web app jo WhatsApp pairing code generate karta hai. User apna number daalta hai, 8-digit
code milta hai, WhatsApp ke "Link with phone number" me daal kar device link ho jata hai.
Link hote hi ek base64 "session string" milta hai jo seedha aapke bot ke `SESSION_ID`
environment variable me daala ja sakta hai — dobara QR/pairing ki zaroorat nahi.

## Project structure

```
wa-pairing/
├── server.js              # Express + Baileys backend (pairing logic)
├── restore-session.js      # Helper to use INSIDE your bot — decodes the session string
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── package.json
└── .gitignore
```

## 1. Local test (optional but recommended before deploying)

```bash
npm install
npm start
```

Open `http://localhost:3000`, apna number try karo. Agar local internet WhatsApp ke
servers tak pohanch sakta hai to code aana chahiye.

## 2. Deploy to Railway (free tier)

1. Is folder ko apne GitHub repo me push karo (e.g. naya repo `subhan-md-pairing`):
   ```bash
   git init
   git add .
   git commit -m "WhatsApp pairing site"
   git branch -M main
   git remote add origin https://github.com/<your-username>/subhan-md-pairing.git
   git push -u origin main
   ```
2. [railway.app](https://railway.app) par jao → **New Project** → **Deploy from GitHub repo** → ye repo select karo.
3. Railway khud `package.json` se Node detect kar lega aur `npm install && npm start` chalayega — koi extra config nahi chahiye.
4. Deploy hone ke baad Railway ek public URL dega (Settings → Networking → Generate Domain). Wahi URL site ka link hai.

Koi `PORT` set karne ki zaroorat nahi — code already `process.env.PORT` use karta hai jo Railway khud provide karta hai.

## 3. Using the session string in your bot (SUBHAN MD)

```js
import { restoreSession } from './restore-session.js';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';

restoreSession(process.env.SESSION_ID, './auth'); // SESSION_ID = string from the site
const { state, saveCreds } = await useMultiFileAuthState('./auth');
// ... makeWASocket({ auth: state }) as normal — connects directly, no pairing again
```

`SESSION_ID` ko apne bot ke Railway project me environment variable ke taur par add kar dena.

## Auto-DM with copy button

Jaise hi number link hota hai, bot khud usi number ko ek WhatsApp message bhejta hai —
"Your Session ID Is 👇" / "Thanks For Connecting" — jis me ek native **Copy Session ID**
button hota hai (WhatsApp ke `cta_copy` interactive type se). Tap karte hi session string
clipboard me copy ho jata hai, bilkul jaise screenshot me dikhaya tha. Ye site ke andar
dikhne wale session string ke ilawa hai — fallback ke taur par site wala bhi hamesha kaam
karega agar kabhi WhatsApp ne ye internal message type restrict kar diya.

## Notes / limitations

- **Sessions are temporary.** Server sirf RAM + ek temp folder me session rakhta hai jab tak
  pairing complete na ho; uske baad folder delete ho jata hai. Session string ko turant copy
  kar lena — dobara dikhega nahi.
- **5 minute window.** Agar code 5 minute me use nahi hota to session expire ho jata hai,
  naya generate karna padega.
- **Rate limits.** WhatsApp khud ek number par baar baar pairing codes request karne par
  thodi der ke liye block kar sakta hai — agar aisa ho to kuch minute wait karo.
- **Keep the session string private.** Jis ke paas ye string hai uska WhatsApp account uske
  paas full access ke saath chala jata hai — jaisे QR code screenshot share na karna, waise
  hi is string ko bhi kisi ke saath share na karna.
- Railway free tier process restart/sleep ho sakta hai agar deploy ke beech me ho to active
  pairing session reset ho jayega — bas dobara number daal kar try karna.
