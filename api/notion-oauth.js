// 노션 OAuth — client_secret이 브라우저에 새지 않게 코드↔토큰 교환을 서버에서만 한다.
// 공개(public) 연결에만 OAuth가 있으므로 내부 통합 토큰 입력 경로는 그대로 남겨둔다.

const AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

function readCookie(req, name) {
  const m = new RegExp('(?:^|;\s*)' + name + '=([^;]*)').exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
}

async function exchange(body, id, secret) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description || d.error || '토큰 교환 실패');
  return d;
}

export default async function handler(req, res) {
  const CLIENT_ID = process.env.NOTION_CLIENT_ID;
  const CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const origin = `${proto}://${host}`;
  const redirectUri = `${origin}/api/notion-oauth`; // 배포·로컬 주소를 각각 하드코딩하지 않으려고 요청 호스트에서 만든다
  const back = (frag) => { res.writeHead(302, { Location: `${origin}/#${frag}` }); res.end(); };
  const fail = (msg) => back('nerr=' + encodeURIComponent(msg));

  if (!CLIENT_ID || !CLIENT_SECRET) {
    if (req.method === 'POST') return res.status(503).json({ error: 'OAuth 미설정' });
    return fail('노션 로그인 미설정 — 서버에 NOTION_CLIENT_ID·SECRET 필요');
  }

  // 갱신 — 노션은 갱신할 때마다 refresh_token도 새로 준다(회전), 그래서 둘 다 돌려준다
  if (req.method === 'POST') {
    const rt = (req.body && req.body.refresh_token) || '';
    if (!rt) return res.status(400).json({ error: 'refresh_token 필요' });
    try {
      const d = await exchange({ grant_type: 'refresh_token', refresh_token: rt }, CLIENT_ID, CLIENT_SECRET);
      return res.status(200).json({ access_token: d.access_token || '', refresh_token: d.refresh_token || '' });
    } catch (e) { return res.status(401).json({ error: e.message }); }
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const secureFlag = proto === 'https' ? '; Secure' : ''; // 로컬 http에서 Secure를 붙이면 쿠키가 아예 안 심긴다

  // 1단계: 시작 — state를 쿠키에 심고 노션 동의 화면으로
  if (!q.code && !q.error) {
    const state = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now());
    res.setHeader('Set-Cookie', `snlog_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureFlag}`);
    const url = `${AUTH_URL}?client_id=${encodeURIComponent(CLIENT_ID)}&response_type=code&owner=user`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    res.writeHead(302, { Location: url });
    return res.end();
  }

  // 2단계: 복귀 — 쿠키는 한 번 쓰고 즉시 버린다
  res.setHeader('Set-Cookie', `snlog_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`);
  if (q.error) return fail(q.error === 'access_denied' ? '노션 로그인 취소됨' : String(q.error));
  if (!q.state || q.state !== readCookie(req, 'snlog_oauth_state')) return fail('인증 상태 불일치 — 다시 시도');

  try {
    const d = await exchange({ grant_type: 'authorization_code', code: String(q.code), redirect_uri: redirectUri }, CLIENT_ID, CLIENT_SECRET);
    if (!d.access_token) throw new Error('토큰 없음');
    // 토큰은 쿼리가 아니라 프래그먼트로 — 프래그먼트는 서버 로그·리퍼러에 남지 않는다
    return back('nt=' + encodeURIComponent(d.access_token)
      + '&nr=' + encodeURIComponent(d.refresh_token || '')
      + '&nw=' + encodeURIComponent(d.workspace_name || ''));
  } catch (e) { return fail(e.message); }
}
