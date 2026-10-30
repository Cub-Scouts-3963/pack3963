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

  let firstVisibleMonthOpened = false;

  document.querySelectorAll('.event-month').forEach((monthGroup) => {
    const visibleMonthEvents = Array.from(monthGroup.querySelectorAll('.event-card'))
      .filter((eventCard) => !eventCard.hidden);
    const countLabel = monthGroup.querySelector('[data-month-count]');

    monthGroup.hidden = visibleMonthEvents.length === 0;
    monthGroup.open = !monthGroup.hidden && !firstVisibleMonthOpened;

    if (monthGroup.open) {
      firstVisibleMonthOpened = true;
    }

    if (countLabel) {
      const count = visibleMonthEvents.length;
      countLabel.textContent = `${count} ${count === 1 ? 'event' : 'events'}`;
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
