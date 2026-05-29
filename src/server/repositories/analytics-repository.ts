import type { GlobalAnalytics, LinkClickDetail, LinkOverviewAnalytics } from '@/shared/types.js';
import { getDb } from '../db.js';
import { createId } from '../utils.js';

export interface AnalyticsEventInput {
  linkId: string;
  slug: string;
  timestamp: string;
  browser: string;
  os: string;
  deviceType: string;
  referrer: string;
  country: string;
  region: string;
  city: string | null;
  language: string | null;
  trafficType: 'human' | 'bot' | 'unknown';
  authOutcome?: 'success' | 'failed_password';
  visitorHash: string;
  rawIp?: string | null;
}

export class AnalyticsRepository {
  private db = getDb();

  private formatLocalDate(
    date: Date,
    timezoneOffsetMinutes: number,
    options: { includeHour?: boolean; includeMonthName?: boolean } = {}
  ) {
    const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60000);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    const hour = String(shifted.getUTCHours()).padStart(2, '0');

    if (options.includeHour) {
      return `${year}-${String(month + 1).padStart(2, '0')}-${day} ${hour}:00`;
    }

    if (options.includeMonthName) {
      const monthLabel = shifted.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      return `${Number(day)} ${monthLabel}`;
    }

    return `${year}-${String(month + 1).padStart(2, '0')}-${day}`;
  }

  private getRangeFrame(range: 'day' | 'week' | 'month', timezoneOffsetMinutes = 0) {
    const shiftToLocalWall = (date: Date) => new Date(date.getTime() + timezoneOffsetMinutes * 60000);
    const shiftToUtcInstant = (date: Date) => new Date(date.getTime() - timezoneOffsetMinutes * 60000);
    const now = new Date();
    const localNow = shiftToLocalWall(now);
    const sqliteOffsetModifier = `${timezoneOffsetMinutes >= 0 ? '+' : ''}${timezoneOffsetMinutes} minutes`;

    if (range === 'day') {
      const localEnd = new Date(localNow);
      localEnd.setUTCMinutes(0, 0, 0);
      localEnd.setUTCHours(localEnd.getUTCHours() + 1);
      const localStart = new Date(localEnd);
      localStart.setUTCHours(localStart.getUTCHours() - 24);
      const localPreviousStart = new Date(localStart);
      localPreviousStart.setUTCHours(localPreviousStart.getUTCHours() - 24);

      return {
        start: shiftToUtcInstant(localStart),
        end: shiftToUtcInstant(localEnd),
        previousStart: shiftToUtcInstant(localPreviousStart),
        labels: Array.from({ length: 24 }, (_, index) => {
          const bucketDate = new Date(localStart);
          bucketDate.setUTCHours(bucketDate.getUTCHours() + index);
          return this.formatLocalDate(bucketDate, 0, { includeHour: true }).slice(11);
        }),
        bucketSql: `strftime('%Y-%m-%d %H:00', timestamp, '${sqliteOffsetModifier}')`,
        normalizeBucket: (bucket: string) => bucket,
        bucketKeys: Array.from({ length: 24 }, (_, index) => {
          const bucketDate = new Date(localStart);
          bucketDate.setUTCHours(bucketDate.getUTCHours() + index);
          return this.formatLocalDate(bucketDate, 0, { includeHour: true });
        })
      };
    }

    if (range === 'week') {
      const localStart = new Date(localNow);
      const day = localStart.getUTCDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      localStart.setUTCDate(localStart.getUTCDate() + diffToMonday);
      localStart.setUTCHours(0, 0, 0, 0);
      const localEnd = new Date(localStart);
      localEnd.setUTCDate(localEnd.getUTCDate() + 7);
      const localPreviousStart = new Date(localStart);
      localPreviousStart.setUTCDate(localPreviousStart.getUTCDate() - 7);

      return {
        start: shiftToUtcInstant(localStart),
        end: shiftToUtcInstant(localEnd),
        previousStart: shiftToUtcInstant(localPreviousStart),
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        bucketSql: `strftime('%w', timestamp, '${sqliteOffsetModifier}')`,
        normalizeBucket: (bucket: string) =>
          ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(bucket)]
      };
    }

    const localEnd = new Date(localNow);
    localEnd.setUTCHours(0, 0, 0, 0);
    localEnd.setUTCDate(localEnd.getUTCDate() + 1);
    const localStart = new Date(localEnd);
    localStart.setUTCDate(localStart.getUTCDate() - 30);
    const localPreviousStart = new Date(localStart);
    localPreviousStart.setUTCDate(localPreviousStart.getUTCDate() - 30);

    return {
      start: shiftToUtcInstant(localStart),
      end: shiftToUtcInstant(localEnd),
      previousStart: shiftToUtcInstant(localPreviousStart),
      labels: Array.from({ length: 30 }, (_, index) => {
        const bucketDate = new Date(localStart);
        bucketDate.setUTCDate(bucketDate.getUTCDate() + index);
        return this.formatLocalDate(bucketDate, 0, { includeMonthName: true });
      }),
      bucketSql: `strftime('%Y-%m-%d', timestamp, '${sqliteOffsetModifier}')`,
      normalizeBucket: (bucket: string) => bucket,
      bucketKeys: Array.from({ length: 30 }, (_, index) => {
        const bucketDate = new Date(localStart);
        bucketDate.setUTCDate(bucketDate.getUTCDate() + index);
        return this.formatLocalDate(bucketDate, 0);
      })
    };
  }

  record(event: AnalyticsEventInput) {
    this.db
      .prepare(
        `INSERT INTO analytics_events (
          id, link_id, slug, timestamp, browser, os, device_type, referrer, country, region, city, language, traffic_type, auth_outcome, visitor_hash, raw_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId(),
        event.linkId,
        event.slug,
        event.timestamp,
        event.browser,
        event.os,
        event.deviceType,
        event.referrer,
        event.country,
        event.region,
        event.city,
        event.language,
        event.trafficType,
        event.authOutcome ?? 'success',
        event.visitorHash,
        event.rawIp ?? null
      );
  }

  deleteOlderThan(cutoffIso: string) {
    return this.db
      .prepare('DELETE FROM analytics_events WHERE timestamp < ?')
      .run(cutoffIso).changes;
  }

  clearAll() {
    return this.db.prepare('DELETE FROM analytics_events').run().changes;
  }

  clearForLink(linkId: string) {
    return this.db.prepare('DELETE FROM analytics_events WHERE link_id = ?').run(linkId).changes;
  }

  getOverview(linkId: string, range: 'day' | 'week' | 'month', timezoneOffsetMinutes = 0): LinkOverviewAnalytics {
    const frame = this.getRangeFrame(range, timezoneOffsetMinutes);

    const grouped = this.db
      .prepare(
        `SELECT
          ${frame.bucketSql} as bucket,
          SUM(CASE WHEN auth_outcome = 'success' THEN 1 ELSE 0 END) as clicks,
          COUNT(DISTINCT CASE WHEN auth_outcome = 'success' THEN visitor_hash END) as uniqueVisitors,
          SUM(CASE WHEN auth_outcome = 'failed_password' THEN 1 ELSE 0 END) as failedAuths
         FROM analytics_events
         WHERE link_id = ? AND timestamp >= ? AND timestamp < ?
         GROUP BY bucket`
      )
      .all(linkId, frame.start.toISOString(), frame.end.toISOString()) as Array<{
        bucket: string;
        clicks: number;
        uniqueVisitors: number;
        failedAuths: number;
      }>;

    const groupedMap = new Map(
      grouped.map((row) => [
        frame.normalizeBucket(row.bucket),
        {
          clicks: row.clicks,
          uniqueVisitors: row.uniqueVisitors,
          failedAuths: row.failedAuths
        }
      ])
    );

    const points = frame.labels.map((label, index) => {
      const bucketKey =
        'bucketKeys' in frame && Array.isArray(frame.bucketKeys) ? frame.bucketKeys[index] : label;

      return {
        label,
        clicks: groupedMap.get(bucketKey)?.clicks ?? 0,
        uniqueVisitors: groupedMap.get(bucketKey)?.uniqueVisitors ?? 0,
        failedAuths: groupedMap.get(bucketKey)?.failedAuths ?? 0
      };
    });

    const total = this.db
      .prepare(
        `SELECT
          COUNT(*) as totalClicks,
          COUNT(DISTINCT visitor_hash) as uniqueVisitors,
          COUNT(DISTINCT referrer) as referrers
         FROM analytics_events
         WHERE link_id = ? AND auth_outcome = 'success'`
      )
      .get(linkId) as { totalClicks: number; uniqueVisitors: number; referrers: number };

    const previous = this.db
      .prepare(
        `SELECT COUNT(*) as clicks
         FROM analytics_events
         WHERE link_id = ? AND auth_outcome = 'success' AND timestamp >= ? AND timestamp < ?`
      )
      .get(linkId, frame.previousStart.toISOString(), frame.start.toISOString()) as { clicks: number };

    const currentWindowClicks = points.reduce((sum, point) => sum + point.clicks, 0);
    const trendBase = previous.clicks || 1;

    return {
      totalClicks: total.totalClicks,
      uniqueVisitors: total.uniqueVisitors,
      referrers: total.referrers,
      trend: Number((((currentWindowClicks - previous.clicks) / trendBase) * 100).toFixed(1)),
      points
    };
  }

  getRecentClicks(linkId: string, limit: number): LinkClickDetail[] {
    return this.db
      .prepare(
        `SELECT
          id,
          timestamp,
          raw_ip as ipAddress,
          browser,
          os,
          device_type as device,
          referrer,
          country,
          city,
          language,
          traffic_type as trafficType
         FROM analytics_events
         WHERE link_id = ? AND auth_outcome = 'success'
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(linkId, limit) as unknown as LinkClickDetail[];
  }

  getGlobalAnalytics(timezoneOffsetMinutes = 0): GlobalAnalytics {
    const totals = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM analytics_events) as clicks,
          (SELECT COUNT(*) FROM links) as links,
          (SELECT COUNT(DISTINCT referrer) FROM analytics_events WHERE auth_outcome = 'success') as referrers,
          (SELECT COUNT(DISTINCT device_type) FROM analytics_events WHERE auth_outcome = 'success') as devices`
      )
      .get() as GlobalAnalytics['totals'];

    const shiftToLocalWall = (date: Date) => new Date(date.getTime() + timezoneOffsetMinutes * 60000);
    const shiftToUtcInstant = (date: Date) => new Date(date.getTime() - timezoneOffsetMinutes * 60000);
    const now = new Date();
    const localNow = shiftToLocalWall(now);
    const localEnd = new Date(localNow);
    localEnd.setUTCHours(0, 0, 0, 0);
    localEnd.setUTCDate(localEnd.getUTCDate() + 1);
    const localStart = new Date(localEnd);
    localStart.setUTCDate(localStart.getUTCDate() - 30);
    const sqliteOffsetModifier = `${timezoneOffsetMinutes >= 0 ? '+' : ''}${timezoneOffsetMinutes} minutes`;

    const monthTrendRows = this.db
      .prepare(
        `SELECT strftime('%Y-%m-%d', timestamp, '${sqliteOffsetModifier}') as day, COUNT(*) as value
         FROM analytics_events
         WHERE auth_outcome = 'success' AND timestamp >= ? AND timestamp < ?
         GROUP BY day
         ORDER BY day ASC`
      )
      .all(shiftToUtcInstant(localStart).toISOString(), shiftToUtcInstant(localEnd).toISOString()) as Array<{ day: string; value: number }>;

    const monthTrendMap = new Map(monthTrendRows.map((row) => [row.day, row.value]));
    const monthTrend = Array.from({ length: 30 }, (_, index) => {
      const dayDate = new Date(localStart);
      dayDate.setUTCDate(dayDate.getUTCDate() + index);
      const dayKey = this.formatLocalDate(dayDate, 0);
      return {
        label: this.formatLocalDate(dayDate, 0, { includeMonthName: true }),
        clicks: monthTrendMap.get(dayKey) ?? 0
      };
    });

    const weeklyHeatmap = this.db
      .prepare(
        `SELECT strftime('%w', timestamp, '${sqliteOffsetModifier}') as weekday, strftime('%H', timestamp, '${sqliteOffsetModifier}') as hour, COUNT(*) as value
         FROM analytics_events
         WHERE auth_outcome = 'success'
         GROUP BY weekday, hour`
      )
      .all()
      .map((row) => ({
        day: ((Number((row as any).weekday) + 6) % 7) + 1,
        hour: Number((row as any).hour),
        value: Number((row as any).value)
      }));

    const group = (field: string, alias = 'label') =>
      this.db
        .prepare(
          `SELECT ${field} as ${alias}, COUNT(*) as value
           FROM analytics_events
           WHERE auth_outcome = 'success' AND ${field} IS NOT NULL AND ${field} != ''
           GROUP BY ${field}
           ORDER BY value DESC
           LIMIT 8`
        )
        .all() as Array<{ label: string; value: number }>;

    const topSlugs = this.db
      .prepare(
        `SELECT links.id as id, analytics_events.slug as slug, COUNT(*) as value
         FROM analytics_events
         INNER JOIN links ON links.id = analytics_events.link_id
         WHERE analytics_events.auth_outcome = 'success'
         GROUP BY analytics_events.link_id, analytics_events.slug
         ORDER BY value DESC
         LIMIT 8`
      )
      .all() as Array<{ id: string; slug: string; value: number }>;

    return {
      totals,
      monthlyTrend: monthTrend,
      weeklyHeatmap,
      top: {
        referrers: group('referrer'),
        slugs: topSlugs,
        languages: group('language')
      },
      devices: {
        devices: group('device_type'),
        operatingSystems: group('os'),
        browsers: group('browser')
      }
    };
  }
}
