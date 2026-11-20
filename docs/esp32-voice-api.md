# Pocket Tuna voice API (for the ESP32 gadget)

One HTTPS call per spoken turn. The server does speech-to-text, the kid-safe pet reply and text-to-speech.

```
POST https://ltqbquaazmspeludhabx.supabase.co/functions/v1/pet-voice
Headers: apikey: <SB_KEY publishable key>, Content-Type: application/json
```

## Talk (audio in → pet voice out)

```json
{
  "mode": "talk",
  "user": "<username>",
  "token": "<token from tama_login>",
  "audio": { "mime": "audio/wav", "b64": "<base64 WAV, 16 kHz mono 16-bit is fine>" },
  "msgs": [ {"role":"user","content":"..."}, {"role":"assistant","content":"[happy] ..."} ],
  "voice": "Leda",
  "format": "wav"
}
```

- `msgs` is optional recent history (max 14). Without it each turn starts fresh.
- No `sys` needed: the server builds the pet persona from the account's saved pet (name, species, age, stats) with the kid-safe rules.
- `format: "wav"` asks for PCM WAV only (no MP3 fallback), easiest for the ES8311 codec. Omit it to allow MP3 when Gemini TTS is unavailable.
- Voices: Leda, Zephyr, Puck, Aoede, Kore, Laomedeia, Achernar, Callirrhoe.

Response:

```json
{
  "ok": true,
  "heard": "สวัสดีจ้า",
  "text": "สวัสดีจ้า วันนี้เล่นอะไรกันดี",
  "ex": "happy",
  "audio": { "mime": "audio/wav", "b64": "..." },
  "src": "groq", "tts": "gemini",
  "ms": { "stt": 457, "chat": 349, "tts": 3093 }
}
```

- `ex` is one of: think, yes, no, excited, sad, cry, sulk, shy, happy. Draw the matching face.
- `heard` empty means no speech was detected: show the "think" face and listen again.
- `audio` may be null if TTS failed: show `text` on screen.
- Errors: `{ok:false, err}` with `auth` (log in again), `daily` (300 turns per account per day), `stt`, `busy`, `no_stt` (no Groq or Gemini key set).

## TTS only

```json
{ "mode": "tts", "user": "...", "token": "...", "text": "...", "voice": "Leda", "format": "wav" }
```

Returns `{ok, audio:{mime,b64}, src}`.

## Device flow

1. Hold button → record WAV from the onboard mic (16 kHz mono).
2. Release → POST `talk`, show the "think" face while waiting (~3–5 s).
3. Set the face from `ex`, play `audio` through the speaker, animate the mouth from sample amplitude.
4. Keep the last few turns in RAM and send them as `msgs`.

Keys (Groq / Gemini) live on the server and are set from the web app under "ตั้งค่า AI". The device never holds them.

# Walkie-talkie (วอ) API

Plain Supabase RPCs: `POST https://ltqbquaazmspeludhabx.supabase.co/rest/v1/rpc/<name>` with header `apikey: <publishable key>` and JSON body. Every call includes `p_user` and `p_token`.

Only mutual contacts can talk: A enters B's 6-digit code (`tama_wt_add`), then B accepts (`tama_wt_accept`) or enters A's code.

| RPC | Extra args | Returns |
|---|---|---|
| `tama_wt_code` | – | `{ok, code}` this device's 6-digit code |
| `tama_wt_add` | `p_code` | `{ok, u, name, mutual}` / `err: not_found, self, rate` |
| `tama_wt_accept` | `p_other` | `{ok}` |
| `tama_wt_remove` | `p_other` | `{ok}` |
| `tama_wt_contacts` | – | `{ok, list:[{u, name, st, unread}]}`; st `a` = can talk, `b` = waiting for them, `c` = they asked you |
| `tama_wt_send` | `p_to, p_mime:"audio/wav", p_audio:<base64>, p_secs` | `{ok, id}` |
| `tama_wt_inbox` | `p_after` (last seen id) | `{ok, list:[{id, from, name, secs, heard, at}]}` |
| `tama_wt_thread` | `p_other` | last 12 messages both ways |
| `tama_wt_get` | `p_id` | `{ok, mime, b64, secs}` and marks it heard |

Audio: WAV, 16 kHz, mono, 16-bit, max ~12 s (base64 ≤ 900 KB). Poll `tama_wt_inbox` every few seconds; play new clips automatically. Messages are kept 7 days; 200 sends per account per day.
