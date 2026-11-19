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
