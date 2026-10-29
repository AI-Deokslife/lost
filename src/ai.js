// Workers AI로 사진을 보고 품목·색상·특징을 추천합니다.
import { CATEGORIES, COLORS } from './config.js';

const PROMPT = `학교에서 주운 분실물 사진입니다. 아래 형식의 JSON 하나만 출력하세요. 설명 문장은 쓰지 마세요.
{
  "category": ${JSON.stringify(CATEGORIES)} 중 하나,
  "color": ${JSON.stringify(COLORS)} 중 하나 (물건의 주된 색),
  "description": "물건 이름과 눈에 띄는 특징을 한국어 25자 이내로 (예: 파란색 텀블러, 스티커 부착)",
  "valuable": 지갑·휴대폰·현금·카드·신분증이면 true, 아니면 false,
  "sensitive": 사진에 이름·학번·학생증·카드번호·휴대폰 화면 등 개인정보가 보이면 true, 아니면 false
}`;

export async function aiTag(env, dataUrl) {
  const res = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct', {
    messages: [{ role: 'user', content: [
      { type: 'text', text: PROMPT },
      { type: 'image_url', image_url: { url: dataUrl } },
    ] }],
    max_tokens: 300,
    temperature: 0.2,
  });
  const out = res?.response ?? res?.choices?.[0]?.message?.content ?? res;
  let parsed = typeof out === 'object' ? out : null;
  if (!parsed) {
    const m = String(out).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 응답을 해석하지 못했습니다.');
    parsed = JSON.parse(m[0]);
  }
  return {
    category: CATEGORIES.includes(parsed.category) ? parsed.category : '',
    color: COLORS.includes(parsed.color) ? parsed.color : '',
    description: String(parsed.description || '').slice(0, 60),
    valuable: parsed.valuable === true,
    sensitive: parsed.sensitive === true,
  };
}
