const councilFeedUrl = 'https://scoutcal.com/18736.rss';
const councilCalendarUrl = 'https://scoutingevent.com/456';
const councilStatus = document.getElementById('council-events-status');
const councilList = document.getElementById('council-events-list');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatCouncilDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
};

if (councilStatus && councilList) {
  fetch(councilFeedUrl)
    .then((response) => { if (!response.ok) throw new Error('Council feed unavailable'); return response.text(); })
    .then((xmlText) => {
      const safeXmlText = xmlText
        .replaceAll('&rsquo;', '&#8217;')
        .replaceAll('&lsquo;', '&#8216;')
        .replaceAll('&rdquo;', '&#8221;')
        .replaceAll('&ldquo;', '&#8220;')
        .replaceAll('&mdash;', '&#8212;')
        .replaceAll('&ndash;', '&#8211;')
        .replaceAll('&nbsp;', '&#160;')
        .replaceAll('&hellip;', '&#8230;');
      const xml = new DOMParser().parseFromString(safeXmlText, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Council feed unreadable');
      const items = Array.from(xml.querySelectorAll('item')).map((item) => ({
        title: item.querySelector('title')?.textContent?.trim() || 'Council event',
        date: item.querySelector('pubDate, date')?.textContent?.trim() || '',
        location: item.querySelector('location')?.textContent?.trim() || '',
        description: item.querySelector('description')?.textContent?.trim().replace(/<[^>]*>/g, '') || '',
        link: item.querySelector('link')?.textContent?.trim() || councilFeedUrl
      }));
      if (!items.length) throw new Error('No council events found');
      councilList.innerHTML = items.map((item) => `<article class="callout-box council-event-card"><p class="page-kicker">${escapeHtml(formatCouncilDate(item.date))}</p><h2>${escapeHtml(item.title)}</h2>${item.location ? `<p><strong>Location:</strong> ${escapeHtml(item.location)}</p>` : ''}${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}<p><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">View council event details</a></p></article>`).join('');
      councilStatus.hidden = true;
    })
    .catch(() => { councilStatus.innerHTML = `The live council event list is temporarily unavailable. <a href="${councilCalendarUrl}" target="_blank" rel="noopener noreferrer">View the full Pathway to Adventure Council calendar</a> for the latest events.`; });
}
