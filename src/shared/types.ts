export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}

export interface LinkRecord {
  id: string;
  slug: string;
  shortUrl: string;
  targetUrl: string;
  comment: string | null;
  passwordProtected: boolean;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  clickCount: number;
  uniqueClickCount: number;
}

export interface LinkFormInput {
  targetUrl: string;
  slug?: string;
  comment?: string;
  password?: string;
  expirationValue?: number | null;
  expirationUnit?: 'minutes' | 'hours' | 'days';
}

export interface LinkOverviewAnalytics {
  totalClicks: number;
  uniqueVisitors: number;
  referrers: number;
  trend: number;
  points: Array<{ label: string; clicks: number; uniqueVisitors: number; failedAuths: number }>;
}

export interface LinkClickDetail {
  id: string;
  timestamp: string;
  ipAddress: string | null;
  browser: string;
  os: string;
  device: string;
  referrer: string;
  country: string;
  city: string | null;
  language: string | null;
  trafficType: 'human' | 'bot' | 'unknown';
}

export interface LinkDetailsResponse {
  link: LinkRecord;
  overview: LinkOverviewAnalytics;
  recentClicks: LinkClickDetail[];
}

export interface GlobalAnalytics {
  totals: {
    clicks: number;
    links: number;
    referrers: number;
    devices: number;
  };
  monthlyTrend: Array<{ label: string; clicks: number }>;
  weeklyHeatmap: Array<{ day: number; hour: number; value: number }>;
  top: {
    referrers: Array<{ label: string; value: number }>;
    slugs: Array<{ id: string; slug: string; value: number }>;
    languages: Array<{ label: string; value: number }>;
  };
  devices: {
    devices: Array<{ label: string; value: number }>;
    operatingSystems: Array<{ label: string; value: number }>;
    browsers: Array<{ label: string; value: number }>;
  };
}

export interface SecuritySettings {
  loginMaxFailedAttempts: number;
  loginAttemptWindowMinutes: number;
  loginBlockMinutes: number;
  protectedLinkMaxFailedAttempts: number;
  protectedLinkAttemptWindowMinutes: number;
  protectedLinkBlockMinutes: number;
  minSlugLength: number;
  maxSlugLength: number;
  slugAllowedChars: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  theme: ThemeMode;
}

export interface PublicAppConfig {
  appName: string;
  appDescription: string;
}
