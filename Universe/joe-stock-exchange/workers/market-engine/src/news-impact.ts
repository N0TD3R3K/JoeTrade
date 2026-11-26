const directionMultiplier: Record<string, number> = {
  bullish: 1,
  bearish: -1,
  mixed: 0.15,
  uncertain: 0,
};

const severityImpact: Record<string, number> = {
  mild: 0.005,
  moderate: 0.015,
  major: 0.035,
};

const decay = [0.6, 0.25, 0.15];

export interface AppliedNews {
  id: string;
  headline: string;
  impact: number;
}

export async function newsImpactForAsset(
  db: D1Database,
  ticker: string,
  scheduledAt: Date,
): Promise<{ total: number; events: AppliedNews[] }> {
  const rows = await db
    .prepare(
      `SELECT n.id, n.headline, n.direction, n.severity, n.duration_ticks, n.published_at, n.category, l.consumed_tick_id
       FROM news_events n LEFT JOIN rate_market_event_links l ON l.news_event_id=n.id
      WHERE status = 'published' AND published_at IS NOT NULL
        AND published_at <= ? AND affected_tickers_json LIKE ?
        AND (category='monetary_policy' OR published_at >= datetime(?, '-4 hours'))
      ORDER BY published_at ASC`,
    )
    .bind(scheduledAt.toISOString(), `%"${ticker}"%`, scheduledAt.toISOString())
    .all<Record<string, unknown>>();
  const events: AppliedNews[] = [];
  for (const row of rows.results) {
    const ageHours = Math.max(
      0,
      Math.floor(
        (scheduledAt.getTime() - new Date(String(row.published_at)).getTime()) /
          3_600_000,
      ),
    );
    const duration = Number(row.duration_ticks);
    if (row.category === "monetary_policy") {
      if (row.consumed_tick_id) continue;
      events.push({
        id: String(row.id),
        headline: String(row.headline),
        impact:
          (directionMultiplier[String(row.direction)] ?? 0) *
          severityImpact.mild *
          decay[0],
      });
      continue;
    }
    if (ageHours >= duration || ageHours >= decay.length) continue;
    const impact =
      (directionMultiplier[String(row.direction)] ?? 0) *
      (severityImpact[String(row.severity)] ?? 0) *
      decay[ageHours];
    events.push({ id: String(row.id), headline: String(row.headline), impact });
  }
  return {
    total: events.reduce((sum, event) => sum + event.impact, 0),
    events,
  };
}
