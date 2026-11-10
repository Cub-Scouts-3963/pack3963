const councilFeedUrl = 'https://scoutcal.com/22954.json';

export async function onRequestGet() {
  try {
    const response = await fetch(councilFeedUrl, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      return Response.json({ error: 'Council feed unavailable' }, { status: 502 });
    }

    return new Response(await response.text(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=900, s-maxage=900'
      }
    });
  } catch {
    return Response.json({ error: 'Council feed unavailable' }, { status: 502 });
  }
}
