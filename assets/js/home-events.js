const eventDataElement = document.getElementById('events-data');
const nextEventElement = document.getElementById('next-event');

if (eventDataElement && nextEventElement) {
  const events = JSON.parse(eventDataElement.textContent);
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');

  const nextEvent = events
    .filter((event) => event.kind !== 'deadline'
      && (event.end_date || event.date) >= today)
    .sort((first, second) => first.date.localeCompare(second.date))[0];

  if (nextEvent) {
    document.getElementById('next-event-title').textContent = nextEvent.title;
    document.getElementById('next-event-date').textContent = nextEvent.date_label;
    document.getElementById('next-event-time').textContent = nextEvent.time;
    document.getElementById('next-event-description').textContent = nextEvent.description;

    const locationElement = document.getElementById('next-event-location');
    const isPackMeetingLocation = nextEvent.location === 'meeting';
    const locationName = isPackMeetingLocation
      ? nextEventElement.dataset.meetingVenue
      : nextEvent.location;

    if (nextEvent.location_url) {
      const locationLink = document.createElement('a');
      locationLink.href = nextEvent.location_url;
      locationLink.target = '_blank';
      locationLink.rel = 'noopener noreferrer';
      locationLink.textContent = locationName;
      locationElement.appendChild(locationLink);
    } else {
      locationElement.textContent = locationName;
    }

    if (isPackMeetingLocation) {
      locationElement.append(` — ${nextEventElement.dataset.meetingAddress}`);
    }

    nextEventElement.hidden = false;
  }
}
