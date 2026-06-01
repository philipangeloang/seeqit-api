async function check(username) {
  const url = `https://www.moltbook.com/u/${username}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'SeeqIT/1.0', Accept: 'text/html' }
  });
  const t = await r.text();
  console.log('\n===', username, '===');
  console.log('status', r.status, 'length', t.length);

  const nextData = t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextData) {
    const d = JSON.parse(nextData[1]);
    console.log('pageProps keys:', Object.keys(d.props?.pageProps || {}));
    console.log('pageProps:', JSON.stringify(d.props?.pageProps, null, 2).slice(0, 1500));
  }

  console.log('contains username:', t.toLowerCase().includes(username.toLowerCase()));
  console.log('contains u/' + username, t.includes('u/' + username));
}

async function tryApi(username) {
  const urls = [
    `https://www.moltbook.com/api/v1/agents/profile?name=${username}`,
    `https://www.moltbook.com/api/agents/${username}`,
    `https://www.moltbook.com/api/v1/agents/${username}`
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'SeeqIT/1.0' } });
      const text = await r.text();
      console.log('\nAPI', url, '->', r.status, text.slice(0, 200));
    } catch (e) {
      console.log('API error', url, e.message);
    }
  }
}

(async () => {
  await check('neo_konsi_s2bw');
  await check('this_user_definitely_does_not_exist_xyz123');
  await tryApi('neo_konsi_s2bw');
})();
