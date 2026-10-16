import type { AnalyticsBreakdowns, GlobalAnalytics, LinkClickDetail, LinkOverviewAnalytics } from '@/shared/types.js';
import { getDb } from '../db.js';
import { buildAnalyticsBreakdowns, type AnalyticsBreakdownRow } from './analytics-breakdowns.js';
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
    const offset = Number.isFinite(timezoneOffsetMinutes)
      ? Math.max(-840, Math.min(840, Math.trunc(timezoneOffsetMinutes)))
      : 0;
    const shiftToLocalWall = (date: Date) => new Date(date.getTime() + offset * 60000);
    const shiftToUtcInstant = (date: Date) => new Date(date.getTime() - offset * 60000);
    const now = new Date();
    const localNow = shiftToLocalWall(now);
    const sqliteOffsetModifier = `${offset >= 0 ? '+' : ''}${offset} minutes`;

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

  getBreakdowns(linkId: string): AnalyticsBreakdowns {
    const rows = this.db
      .prepare(
        `SELECT 'devices' as category, COALESCE(NULLIF(TRIM(device_type), ''), 'Unknown') as label, COUNT(*) as value
         FROM analytics_events WHERE link_id = ? AND auth_outcome = 'success' GROUP BY label
         UNION ALL
         SELECT 'browsers', COALESCE(NULLIF(TRIM(browser), ''), 'Unknown'), COUNT(*)
         FROM analytics_events WHERE link_id = ? AND auth_outcome = 'success' GROUP BY COALESCE(NULLIF(TRIM(browser), ''), 'Unknown')
         UNION ALL
         SELECT 'operatingSystems', COALESCE(NULLIF(TRIM(os), ''), 'Unknown'), COUNT(*)
         FROM analytics_events WHERE link_id = ? AND auth_outcome = 'success' GROUP BY COALESCE(NULLIF(TRIM(os), ''), 'Unknown')
         UNION ALL
         SELECT 'languages', COALESCE(NULLIF(TRIM(language), ''), 'Unknown'), COUNT(*)
         FROM analytics_events WHERE link_id = ? AND auth_outcome = 'success' GROUP BY COALESCE(NULLIF(TRIM(language), ''), 'Unknown')
         ORDER BY category, value DESC, label ASC`
      )
      .all(linkId, linkId, linkId, linkId) as unknown as AnalyticsBreakdownRow[];
    return buildAnalyticsBreakdowns(rows);
  }

  getGlobalActivityOverTime(
    userId: string,
    range: 'day' | 'week' | 'month' = 'month',
    timezoneOffsetMinutes = 0
  ): GlobalAnalytics['activityOverTime'] {
    const activityCte = `
      WITH activity AS (
        SELECT e.timestamp, e.visitor_hash, 'click' as event_kind
        FROM analytics_events e
        INNER JOIN links l ON l.id = e.link_id
        WHERE l.user_id = ? AND e.auth_outcome = 'success'
        UNION ALL
        SELECT c.timestamp, c.visitor_hash, 'click' as event_kind
        FROM page_block_clicks c
        INNER JOIN pages p ON p.id = c.page_id
        WHERE p.user_id = ?
        UNION ALL
        SELECT v.timestamp, v.visitor_hash, 'view' as event_kind
        FROM page_views v
        INNER JOIN pages p ON p.id = v.page_id
        WHERE p.user_id = ?
        UNION ALL
        SELECT v.timestamp, v.visitor_hash, 'view' as event_kind
        FROM live_views v
        INNER JOIN live_activities a ON a.id = v.activity_id
        WHERE a.user_id = ?
      )`;
    const frame = this.getRangeFrame(range, timezoneOffsetMinutes);
    const rows = this.db
      .prepare(
        `${activityCte}
         SELECT
           ${frame.bucketSql} as bucket,
           SUM(CASE WHEN event_kind = 'click' THEN 1 ELSE 0 END) as clicks,
           SUM(CASE WHEN event_kind = 'view' THEN 1 ELSE 0 END) as views,
           COUNT(DISTINCT visitor_hash) as uniqueVisitors
         FROM activity
         WHERE timestamp >= ? AND timestamp < ?
         GROUP BY bucket
         ORDER BY bucket ASC`
      )
      .all(userId, userId, userId, userId, frame.start.toISOString(), frame.end.toISOString()) as Array<{
        bucket: string;
        clicks: number;
        views: number;
        uniqueVisitors: number;
      }>;
    const activityMap = new Map(rows.map((row) => [frame.normalizeBucket(row.bucket), row]));
    return frame.labels.map((label, index) => {
      const date = 'bucketKeys' in frame && Array.isArray(frame.bucketKeys) ? frame.bucketKeys[index] : label;
      const point = activityMap.get(date);
      return {
        date,
        label,
        clicks: Number(point?.clicks ?? 0),
        views: Number(point?.views ?? 0),
        uniqueVisitors: Number(point?.uniqueVisitors ?? 0)
      };
    });
  }

  getGlobalAnalytics(
    userId: string,
    range: 'day' | 'week' | 'month' = 'month',
    timezoneOffsetMinutes = 0
  ): GlobalAnalytics {
    const activityCte = `
      WITH activity AS (
        SELECT e.timestamp, e.visitor_hash, e.device_type, 'links' as source_module, 'click' as event_kind
        FROM analytics_events e
        INNER JOIN links l ON l.id = e.link_id
        WHERE l.user_id = ? AND e.auth_outcome = 'success'
        UNION ALL
        SELECT c.timestamp, c.visitor_hash, NULL as device_type, 'pages' as source_module, 'click' as event_kind
        FROM page_block_clicks c
        INNER JOIN pages p ON p.id = c.page_id
        WHERE p.user_id = ?
        UNION ALL
        SELECT v.timestamp, v.visitor_hash, v.device_type, 'pages' as source_module, 'view' as event_kind
        FROM page_views v
        INNER JOIN pages p ON p.id = v.page_id
        WHERE p.user_id = ?
        UNION ALL
        SELECT v.timestamp, v.visitor_hash, v.device_type, 'live' as source_module, 'view' as event_kind
        FROM live_views v
        INNER JOIN live_activities a ON a.id = v.activity_id
        WHERE a.user_id = ?
      )`;
    const ownerParams = [userId, userId, userId, userId];
    const accessCte = `
      WITH access_events AS MATERIALIZED (
        SELECT e.timestamp, e.visitor_hash, e.device_type, e.browser, e.os, e.referrer, e.language,
          'links' as source_module, e.slug
        FROM analytics_events e
        INNER JOIN links l ON l.id = e.link_id
        WHERE l.user_id = ? AND e.auth_outcome = 'success'
        UNION ALL
        SELECT v.timestamp, v.visitor_hash, v.device_type, v.browser, v.os, v.referrer, v.language,
          'pages' as source_module, p.slug
        FROM page_views v
        INNER JOIN pages p ON p.id = v.page_id
        WHERE p.user_id = ?
        UNION ALL
        SELECT v.timestamp, v.visitor_hash, v.device_type, v.browser, v.os, v.referrer, v.language,
          'live' as source_module, a.slug
        FROM live_views v
        INNER JOIN live_activities a ON a.id = v.activity_id
        WHERE a.user_id = ?
      )`;
    const accessOwnerParams = [userId, userId, userId];

    const totalsRow = this.db
      .prepare(
        `${activityCte}
         SELECT
           SUM(CASE WHEN event_kind = 'click' THEN 1 ELSE 0 END) as clicks,
           SUM(CASE WHEN event_kind = 'view' THEN 1 ELSE 0 END) as views,
           COUNT(DISTINCT visitor_hash) as uniqueVisitors,
           COUNT(DISTINCT CASE
             WHEN device_type IS NOT NULL AND device_type != 'unknown'
             THEN visitor_hash || char(0) || device_type
           END) as devices
         FROM activity`
      )
      .get(...ownerParams) as {
        clicks: number | null;
        views: number | null;
        uniqueVisitors: number;
        devices: number;
      };
    const totals: GlobalAnalytics['totals'] = {
      clicks: Number(totalsRow.clicks ?? 0),
      views: Number(totalsRow.views ?? 0),
      uniqueVisitors: Number(totalsRow.uniqueVisitors ?? 0),
      devices: Number(totalsRow.devices ?? 0)
    };

    const activityOverTime = this.getGlobalActivityOverTime(userId, range, timezoneOffsetMinutes);

    const moduleRows = this.db
      .prepare(
        `${activityCte}
         SELECT
           source_module as module,
           SUM(CASE WHEN event_kind = 'click' THEN 1 ELSE 0 END) as clicks,
           SUM(CASE WHEN event_kind = 'view' THEN 1 ELSE 0 END) as views,
           COUNT(DISTINCT visitor_hash) as uniqueVisitors
         FROM activity
         GROUP BY source_module`
      )
      .all(...ownerParams) as Array<{
        module: GlobalAnalytics['modules'][number]['module'];
        clicks: number;
        views: number;
        uniqueVisitors: number;
      }>;
    const moduleMap = new Map(moduleRows.map((row) => [row.module, row]));
    const modules: GlobalAnalytics['modules'] = (['links', 'pages', 'live'] as const).map((module) => ({
      module,
      clicks: Number(moduleMap.get(module)?.clicks ?? 0),
      views: Number(moduleMap.get(module)?.views ?? 0),
      uniqueVisitors: Number(moduleMap.get(module)?.uniqueVisitors ?? 0)
    }));

    const offset = Number.isFinite(timezoneOffsetMinutes)
      ? Math.max(-840, Math.min(840, Math.trunc(timezoneOffsetMinutes)))
      : 0;
    const sqliteOffsetModifier = `${offset >= 0 ? '+' : ''}${offset} minutes`;
    const activityByTime = this.db
      .prepare(
        `${activityCte}
         SELECT
           ((CAST(strftime('%w', timestamp, '${sqliteOffsetModifier}') AS INTEGER) + 6) % 7) + 1 as day,
           CAST(CAST(strftime('%H', timestamp, '${sqliteOffsetModifier}') AS INTEGER) / 2 AS INTEGER) * 2 as hour,
           SUM(CASE WHEN event_kind = 'click' THEN 1 ELSE 0 END) as clicks,
           SUM(CASE WHEN event_kind = 'view' THEN 1 ELSE 0 END) as views,
           COUNT(DISTINCT visitor_hash) as uniqueVisitors
         FROM activity
         GROUP BY day, hour
         ORDER BY day, hour`
      )
      .all(...ownerParams)
      .map((row) => ({
        day: Number((row as any).day),
        hour: Number((row as any).hour),
        clicks: Number((row as any).clicks),
        views: Number((row as any).views),
        uniqueVisitors: Number((row as any).uniqueVisitors)
      }));

    const filters = ['all', 'links', 'pages', 'live'] as const;
    const topReferrerRows = this.db
      .prepare(
        `${accessCte},
         grouped AS (
           SELECT source_module as filter, COALESCE(NULLIF(TRIM(referrer), ''), 'Direct') as label, COUNT(*) as value
           FROM access_events
           GROUP BY source_module, label
         ),
         expanded AS (
           SELECT filter, label, value FROM grouped
           UNION ALL
           SELECT 'all' as filter, label, SUM(value) as value FROM grouped GROUP BY label
         ),
         ranked AS (
           SELECT filter, label, value,
             SUM(value) OVER (PARTITION BY filter) as total,
             ROW_NUMBER() OVER (PARTITION BY filter ORDER BY value DESC, label ASC) as rank
           FROM expanded
         )
         SELECT filter, label, value, total FROM ranked WHERE rank <= 8 ORDER BY filter, rank`
      )
      .all(...accessOwnerParams) as Array<{
        filter: typeof filters[number];
        label: string;
        value: number;
        total: number;
      }>;
    const topReferrers = Object.fromEntries(filters.map((filter) => [
      filter,
      topReferrerRows
        .filter((row) => row.filter === filter)
        .map((row) => ({ label: row.label, value: Number(row.value) }))
    ])) as GlobalAnalytics['topReferrers'];
    const referrerTotals = Object.fromEntries(filters.map((filter) => [
      filter,
      Number(topReferrerRows.find((row) => row.filter === filter)?.total ?? 0)
    ])) as GlobalAnalytics['referrerTotals'];

    const topSlugRows = this.db
      .prepare(
        `${accessCte},
         grouped AS (
           SELECT source_module as filter, slug, source_module as module, COUNT(*) as value
           FROM access_events
           GROUP BY source_module, slug
         ),
         expanded AS (
           SELECT filter, slug, module, value FROM grouped
           UNION ALL
           SELECT 'all' as filter, slug, module, value FROM grouped
         ),
         ranked AS (
           SELECT filter, slug, module, value,
             ROW_NUMBER() OVER (PARTITION BY filter ORDER BY value DESC, slug ASC) as rank
           FROM expanded
         )
         SELECT filter, slug, module, value FROM ranked WHERE rank <= 8 ORDER BY filter, rank`
      )
      .all(...accessOwnerParams) as Array<{
        filter: typeof filters[number];
        slug: string;
        module: GlobalAnalytics['modules'][number]['module'];
        value: number;
      }>;
    const topSlugs = Object.fromEntries(filters.map((filter) => [
      filter,
      topSlugRows
        .filter((row) => row.filter === filter)
        .map((row) => ({ slug: row.slug, module: row.module, value: Number(row.value) }))
    ])) as GlobalAnalytics['topSlugs'];

    const breakdownRows = this.db
      .prepare(
        `${accessCte}
         SELECT 'devices' as category, COALESCE(NULLIF(TRIM(device_type), ''), 'Unknown') as label, COUNT(*) as value
         FROM access_events GROUP BY label
         UNION ALL
         SELECT 'browsers', COALESCE(NULLIF(TRIM(browser), ''), 'Unknown'), COUNT(*)
         FROM access_events GROUP BY COALESCE(NULLIF(TRIM(browser), ''), 'Unknown')
         UNION ALL
         SELECT 'operatingSystems', COALESCE(NULLIF(TRIM(os), ''), 'Unknown'), COUNT(*)
         FROM access_events GROUP BY COALESCE(NULLIF(TRIM(os), ''), 'Unknown')
         UNION ALL
         SELECT 'languages', COALESCE(NULLIF(TRIM(language), ''), 'Unknown'), COUNT(*)
         FROM access_events GROUP BY COALESCE(NULLIF(TRIM(language), ''), 'Unknown')
         ORDER BY category, value DESC, label ASC`
      )
      .all(...accessOwnerParams) as unknown as AnalyticsBreakdownRow[];
    const breakdowns = buildAnalyticsBreakdowns(breakdownRows);

    return { totals, activityOverTime, modules, activityByTime, topReferrers, referrerTotals, topSlugs, breakdowns };
  }
}
