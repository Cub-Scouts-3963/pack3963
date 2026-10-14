const announcementBanner = document.getElementById('announcement-banner');
const announcementData = document.getElementById('announcement-events-data');

if (announcementBanner && announcementData) {
  const events = JSON.parse(announcementData.textContent);
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');

  const upcomingItems = events
    .filter((event) => (event.end_date || event.date) >= today)
    .sort((first, second) => first.date.localeCompare(second.date));

  const nextEvent = upcomingItems.find((event) => event.kind !== 'deadline');
  const nextDeadline = upcomingItems.find((event) => event.kind === 'deadline');
  const eventMessage = document.getElementById('announcement-event-message');
  const deadlineMessage = document.getElementById('announcement-deadline-message');

  if (nextEvent && eventMessage) {
    eventMessage.textContent = nextEvent.announcement
      || `Next event: ${nextEvent.date_label} — ${nextEvent.title}`;
    eventMessage.hidden = false;
  }

  if (nextDeadline && deadlineMessage) {
    deadlineMessage.textContent = nextDeadline.announcement
      || `Deadline: ${nextDeadline.date_label} — ${nextDeadline.title}`;
    deadlineMessage.hidden = false;
  }

  announcementBanner.hidden = !nextEvent && !nextDeadline;
}
