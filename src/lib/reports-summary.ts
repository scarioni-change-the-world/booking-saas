import { bandName, formatMinor, weekdayName, type Report } from './reports';

/**
 * The figures a written summary is drafted from: the report, made small and
 * anonymous. No client's name, address or email ever leaves for the AI
 * assistant — comments go without who wrote them, quiet clients and
 * stalled programmes go as counts.
 */
export function summaryFacts(report: Report, currency: string) {
  const money = (minor: number) => formatMinor(minor, currency);
  const h = report.headline;
  const pair = (f: { value: number; previous: number | null }) => ({ now: f.value, before: f.previous });
  return {
    period: report.period,
    headline: {
      bookingsMade: pair(h.bookingsMade),
      sessionsHeld: pair(h.sessionsHeld),
      hoursBooked: pair(h.hoursBooked),
      hoursOpen: pair(h.hoursOpen),
      fullness: {
        now: h.utilisation.value === null ? null : Math.round(h.utilisation.value * 100) + '%',
        before: h.utilisation.previous === null ? null : Math.round(h.utilisation.previous * 100) + '%',
      },
      earnedAtYourPrices: {
        now: money(h.valueEarnedMinor.value),
        before: money(h.valueEarnedMinor.previous ?? 0),
      },
      paidOnline: money(h.collectedOnlineMinor.value),
      newClients: pair(h.newClients),
      returningClients: pair(h.returningClients),
      visits: report.tracking.visits ? pair(h.visits) : 'not counted yet',
      rating:
        h.rating.average === null
          ? null
          : { average: Math.round(h.rating.average * 10) / 10, count: h.rating.count },
    },
    journey: report.funnel.steps.map((s) => ({ step: s.label, people: s.count })),
    services: report.services.map((s) => ({
      name: s.name,
      booked: s.booked,
      held: s.held,
      hoursHeld: s.hoursHeld,
      earned: money(s.valueMinor),
      perHour: s.valuePerHourMinor === null ? null : money(s.valuePerHourMinor),
      cancelled: s.cancelled,
      noShows: s.noShows,
      cameBack: s.cameBackRate === null ? null : Math.round(s.cameBackRate * 100) + '%',
      rating: s.rating,
      ratings: s.ratingCount,
      bookedAfterQuestions: s.conversion === null ? null : Math.round(s.conversion * 100) + '%',
      daysBookedAhead: s.medianLeadDays,
    })),
    when: {
      fullest: report.demand.full
        .slice(0, 3)
        .map((b) => `${bandName(b.weekday, b.part)}: ${Math.round(b.fill * 100)}% booked`),
      emptiest: report.demand.quiet
        .slice(0, 3)
        .map((b) => `${bandName(b.weekday, b.part)}: ${b.openHours} open hours, none booked`),
      bookingsAreMadeMostOn: report.demand.bookedWhen
        ? `${weekdayName(report.demand.bookedWhen.weekday)} ${report.demand.bookedWhen.part}`
        : null,
      howFarAhead: report.demand.lead,
    },
    clients: {
      active: report.clients.active,
      cameBack:
        report.clients.cameBackRate === null ? null : Math.round(report.clients.cameBackRate * 100) + '%',
      medianDaysBetweenSessions: report.clients.medianDaysBetween,
      programmesRunning: report.clients.programmes.running,
      programmesCompleted: report.clients.programmes.completed,
      programmesStalled: report.clients.programmes.stalled.length,
      clientsGoneQuiet: report.clients.quiet.length,
    },
    money: {
      earnedAtYourPrices: money(report.money.valueEarnedMinor),
      paidOnline: money(report.money.collectedOnlineMinor),
      refunded: money(report.money.refundedMinor),
      stillToCollectAfterDeposits: money(report.money.depositsToCollectMinor),
      alreadyBookedNext30Days: money(report.money.bookedAheadMinor),
    },
    cancellations: {
      count: report.cancellations.count,
      byClient: report.cancellations.byClient,
      byYou: report.cancellations.byBusiness,
      insideYourNotice: report.cancellations.late,
      medianHoursAhead: report.cancellations.medianHoursAhead,
      noShows: report.cancellations.noShows,
      sessionsMarkedCameOrNot: `${report.cancellations.marked} of ${report.cancellations.past}`,
      moved: report.cancellations.moved,
      reasons: report.cancellations.reasons.map((r) => r.reason),
    },
    sources: report.sources
      .slice(0, 8)
      .map((s) => ({ from: s.label, visits: s.visits, bookings: s.bookings })),
    ratings: {
      average: report.ratings.average,
      count: report.ratings.count,
      comments: report.ratings.comments.map((c) => ({
        rating: c.rating,
        service: c.serviceName,
        said: c.comment,
      })),
    },
    questions: report.questions.slice(0, 5).map((q) => ({
      question: q.prompt,
      answered: q.answered,
      sentElsewhere: q.sentElsewhere,
      commonestAnswerSendingAway: q.routingAnswers[0]?.answer ?? null,
    })),
    alreadyNoted: report.findings.map((f) => f.title),
  };
}
