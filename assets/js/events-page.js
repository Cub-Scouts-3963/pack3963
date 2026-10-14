const eventCards = Array.from(document.querySelectorAll('.event-card'));
const noUpcomingEvents = document.getElementById('no-upcoming-events');

if (eventCards.length) {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');

  const visibleCounts = { pack: 0, community: 0 };

  eventCards.forEach((eventCard) => {
    const eventEndDate = eventCard.dataset.eventEnd;
    const eventHasPassed = Boolean(eventEndDate && eventEndDate < today);

    eventCard.hidden = eventHasPassed;

    if (!eventHasPassed) {
      const eventGroup = eventCard.dataset.eventGroup || 'pack';
      visibleCounts[eventGroup] = (visibleCounts[eventGroup] || 0) + 1;
    }
  });

  if (noUpcomingEvents) {
    noUpcomingEvents.hidden = visibleCounts.pack > 0;
  }

  const noCommunityEvents = document.getElementById('no-community-events');
  if (noCommunityEvents) {
    noCommunityEvents.hidden = visibleCounts.community > 0;
  }

  document.querySelectorAll('[data-resource-end]').forEach((resource) => {
    resource.hidden = resource.dataset.resourceEnd < today;
  });
}
