// WWCS chat moderation: built-in content filter.
//
// Layers:
//   1. Length limits (max 500 chars).
//   2. Blocklist of profanity / slurs / spam phrases (substring match).
//   3. Rate limiting + duplicate detection (enforced in server.js).
//   4. Optional LLM moderation: if MODERATION_API_URL and MODERATION_API_KEY
//      are set, messages are also screened by that endpoint (see README for
//      how to plug in an LLM moderation API).
//
// The blocklist is intentionally kept generic and safe-for-work to read.
// Add terms as the community needs them.

const BLOCKED = [
  // profanity
  'fuck', 'shit', 'bitch', 'bastard', 'dick', 'pussy', 'slut', 'whore',
  'cunt', 'faggot', 'retard', 'nigger', 'nigga', 'chink', 'spic', 'kike',
  'dyke', 'tranny', 'asshole', 'motherfucker',
  // spam / scams
  'crypto giveaway', 'double your bitcoin', 'send me bitcoin',
  'free iphone', 'click here to win', 'work from home $$$', 'make money fast',
  'viagra', 'cialis', 'porn', 'xxx', 'onlyfans',
  // common evasions
  'f u c k', 's h i t', 'a s s h o l e',
];

const MAX_LEN = 500;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    // crude leetspeak normalization so "sh1t" etc. still match
    .replace(/1/g, 'i').replace(/!/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/@/g, 'a').replace(/0/g, 'o')
    .replace(/5/g, 's').replace(/\$/g, 's').replace(/7/g, 't');
}

function builtinCheck(text) {
  if (!text || !text.trim()) return { ok: false, reason: 'Message is empty.' };
  if (text.length > MAX_LEN) return { ok: false, reason: `Message is too long (max ${MAX_LEN} characters).` };
  const n = normalize(text);
  for (const bad of BLOCKED) {
    if (n.includes(bad)) return { ok: false, reason: 'Message was blocked by the community filter.' };
  }
  return { ok: true };
}

// Optional second layer: call an external LLM moderation endpoint.
// Expects the endpoint to accept POST JSON { text } with
// `Authorization: Bearer <MODERATION_API_KEY>` and return JSON like
// { flagged: true/false, reason: "..." }. Any shape mismatch or network
// error fails open (returns null) and the built-in filter still applies.
async function llmCheck(text) {
  const url = process.env.MODERATION_API_URL;
  const key = process.env.MODERATION_API_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.flagged) {
      return { ok: false, reason: data.reason || 'Message was blocked by AI moderation.' };
    }
    return { ok: true };
  } catch {
    return null; // fail open; built-in filter still enforced
  }
}

async function moderate(text) {
  const base = builtinCheck(text);
  if (!base.ok) return base;
  const llm = await llmCheck(text);
  if (llm && !llm.ok) return llm;
  return { ok: true };
}

module.exports = { moderate, builtinCheck, BLOCKED, MAX_LEN };
