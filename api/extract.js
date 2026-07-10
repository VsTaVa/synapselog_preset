// 웹페이지 본문 / 유튜브 자막을 추출해 텍스트로 반환 (브라우저 CORS 우회용)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = (req.query && req.query.url) || (req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'url이 필요해요' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

  function decodeEntities(s) {
    return (s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&nbsp;/g, ' ');
  }

  function ytId(u) {
    const m = u.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  async function extractYouTube(u) {
    const id = ytId(u);
    if (!id) throw new Error('유튜브 영상 ID를 못 찾았어요');
    const page = await (await fetch('https://www.youtube.com/watch?v=' + id, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en' } })).text();
    let title = ((page.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    title = decodeEntities(title).replace(/ - YouTube$/, '').trim();
    const m = page.match(/"captionTracks":(\[[\s\S]*?\])/);
    if (!m) throw new Error('이 영상엔 자막이 없어요 (자막 있는 영상만 가능)');
    let tracks;
    try { tracks = JSON.parse(m[1].replace(/\\u0026/g, '&')); } catch (e) { throw new Error('자막 정보 파싱 실패'); }
    if (!tracks || !tracks.length) throw new Error('이 영상엔 자막이 없어요');
    const pick = tracks.find(t => t.languageCode === 'ko') || tracks.find(t => t.languageCode === 'en') || tracks[0];
    const baseUrl = String(pick.baseUrl || '').replace(/\\u0026/g, '&');
    if (!baseUrl) throw new Error('자막 주소를 못 찾았어요');
    const xml = await (await fetch(baseUrl, { headers: { 'User-Agent': UA } })).text();
    const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
      .map(x => decodeEntities(x[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const text = texts.join(' ');
    if (!text) throw new Error('자막 내용이 비어있어요');
    return { title: title || '유튜브 영상', text };
  }

  async function extractWeb(u) {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en' } });
    if (!r.ok) throw new Error('페이지를 가져오지 못했어요 (HTTP ' + r.status + ')');
    let html = await r.text();
    let title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    title = decodeEntities(title).replace(/\s+/g, ' ').trim();
    html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    const art = html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i);
    const section = art ? art[0] : html;
    let text = section.replace(/<(p|br|div|li|h[1-6])[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
    text = decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('본문을 추출하지 못했어요');
    return { title: title || u, text };
  }

  try {
    const isYt = /(?:youtube\.com|youtu\.be)/i.test(url);
    const data = isYt ? await extractYouTube(url) : await extractWeb(url);
    data.text = (data.text || '').slice(0, 12000);
    return res.status(200).json({ title: data.title, text: data.text, type: isYt ? 'youtube' : 'web' });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
}
