
const councilFeedUrl = '/api/council-events';
const councilCalendarUrl = 'https://scoutingevent.com/456';
const councilStatus = document.getElementById('council-events-status');
const councilList = document.getElementById('council-events-list');
const councilSearch = document.getElementById('council-events-search');
const councilMonth = document.getElementById('council-events-month');
let councilEvents = [];

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const parseScoutDate = (dateValue, timeValue = '000000') => {
  const dateText = String(dateValue || '');
  if (!/^\d{8}$/.test(dateText)) return null;
  const timeText = String(timeValue || '000000').padStart(6, '0');
  const date = new Date(`${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}T${timeText.slice(0, 2)}:${timeText.slice(2, 4)}:${timeText.slice(4, 6)}`);
  return Number.isNaN(date.valueOf()) ? null : date;
};

const formatCouncilDate = (value) => value.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });

const stripMarkup = (value) => {
  const element = document.createElement('div');
  element.innerHTML = value || '';
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
};

const renderCouncilEvents = () => {
  const searchTerm = councilSearch.value.trim().toLowerCase();
  const monthFilter = councilMonth.value;
  const visibleEvents = councilEvents.filter((event) => {
    const searchable = `${event.title} ${event.location} ${event.description} ${event.groups}`.toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm)) && (!monthFilter || event.monthKey === monthFilter);
  });

  if (!visibleEvents.length) {
    councilList.innerHTML = '<p class="callout-box">No council events match those filters.</p>';
    return;
  }

  const groupedEvents = visibleEvents.reduce((groups, event) => {
    (groups[event.monthKey] ||= { label: event.monthLabel, events: [] }).events.push(event);
    return groups;
  }, {});

  councilList.innerHTML = Object.values(groupedEvents).map((group) => `
    <section class="council-event-month">
      <h2>${escapeHtml(group.label)}</h2>
      <div class="council-event-month__items">
        ${group.events.map((event) => `
          <article class="callout-box council-event-card">
            <p class="page-kicker">${escapeHtml(formatCouncilDate(event.startDate))}</p>
            <h3>${escapeHtml(event.title)}</h3>
            ${event.location ? `<p><strong>Location:</strong> ${escapeHtml(event.location)}</p>` : ''}
            ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
            ${event.groups ? `<p class="council-event-tags">${escapeHtml(event.groups)}</p>` : ''}
            <p><a href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">View event details</a></p>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');
};

if (councilStatus && councilList && councilSearch && councilMonth) {
  fetch(councilFeedUrl)
    .then((response) => {
      if (!response.ok) throw new Error('Council feed unavailable');
      return response.json();
    })
    .then((items) => {
      if (!Array.isArray(items)) throw new Error('Council JSON feed unreadable');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      councilEvents = items.map((item) => {
        const startDate = parseScoutDate(item.SDATE_FMT, item.SDATE_TIME);
        const endDate = parseScoutDate(item.EDATE_FMT, item.EDATE_TIME) || startDate;
        return {
          title: item.EVENT_TITLE || item.TITLE || 'Council event',
          startDate,
          endDate,
          location: [item.LOCATION_NAME, item.LOCATION_CITY, item.LOCATION_STATE].filter(Boolean).join(', '),
          description: stripMarkup(item.DESC),
          groups: item.GROUPS || '',
          url: item.URL || councilCalendarUrl
        };
      }).filter((event) => event.startDate && event.endDate >= today)
        .sort((first, second) => first.startDate - second.startDate)
        .map((event) => ({
          ...event,
          monthKey: `${event.startDate.getFullYear()}-${String(event.startDate.getMonth() + 1).padStart(2, '0')}`,
          monthLabel: event.startDate.toLocaleString(undefined, { month: 'long', year: 'numeric' })
        }));

      [...new Map(councilEvents.map((event) => [event.monthKey, event.monthLabel]))].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        councilMonth.appendChild(option);
      });
      renderCouncilEvents();
      councilStatus.textContent = `${councilEvents.length} upcoming council events loaded.`;
    })
    .catch(() => {
      councilStatus.innerHTML = `The live council event list is temporarily unavailable. <a href="${councilCalendarUrl}" target="_blank" rel="noopener noreferrer">View the full Pathway to Adventure Council calendar</a> for the latest events.`;
    });

  councilSearch.addEventListener('input', renderCouncilEvents);
  councilMonth.addEventListener('change', renderCouncilEvents);
}

