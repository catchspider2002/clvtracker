// CLV Tracker - Claude narrative (4 sentences). Deterministic fallback if no key.
const SYSTEM = `You are a quantitative sports betting analyst explaining Closing Line Value (CLV) results to a professional audience.

Given the CLV data for a World Cup match, write a structured analysis with exactly four parts:

1. LINE MOVEMENT SUMMARY: One sentence describing the most significant movement (use exact numbers).
2. MARKET INTERPRETATION: One sentence on what this movement pattern typically indicates (sharp positioning, public fading, news-driven, or efficient stable market).
3. CLV SIGNIFICANCE: One sentence on what the magnitude means in the context of tournament betting markets.
4. OUTCOME CONTEXT: One sentence comparing what the closing line implied vs what actually happened.

Rules:
- Each sentence maximum 25 words.
- Use precise numbers - implied probabilities to 1 decimal place, decimals to 2dp.
- Avoid hedging language - be direct.
- Do not make normative judgements about whether bets were "good" or "bad".
- Output only the four sentences separated by newlines, no labels.`;

export interface AnalyseInput {
  home: string; away: string; finalScore: string; outcome: string; clv: any;
}

export async function analyse(apiKey: string | undefined, input: AnalyseInput): Promise<string> {
  const mm = input.clv.mostMovedMarket;
  const c = input.clv[mm];
  const fallback =
    `${cap(mm)} ${c.direction} ${signed(c.clv)}pp (${c.openingDecimal}→${c.closingDecimal}), the match's biggest move.\n` +
    `${input.clv.verdict}.\n` +
    `Total market movement was ${input.clv.totalMovement}pp across the three outcomes.\n` +
    `Final score ${input.finalScore} (${input.outcome.replace('_', ' ')}); the closing line gave that outcome about ${impliedOf(input)}%.`;
  if (!apiKey) return fallback;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 180, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(input) }] }),
    });
    if (!res.ok) return fallback;
    const data = await res.json() as { content?: { text?: string }[] };
    return data.content?.[0]?.text?.trim() || fallback;
  } catch { return fallback; }
}

function impliedOf(input: AnalyseInput): string {
  const key = input.outcome === 'home_win' ? 'home' : input.outcome === 'away_win' ? 'away' : 'draw';
  const v = input.clv[key]?.closingImplied;
  return v != null ? (v * 100).toFixed(1) : '-';
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n > 0 ? '+' + n : String(n));
