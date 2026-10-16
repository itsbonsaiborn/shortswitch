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

export interface AnalyticsVisitDetail {
  id: string;
  timestamp: string;
  ipAddress: string | null;
  browser: string;
  os: string;
  device: string;
  referrer: string;
  language: string | null;
  context?: string;
  trafficType?: 'human' | 'bot' | 'unknown';
}

export interface LinkClickDetail extends AnalyticsVisitDetail {
  country: string;
  city: string | null;
  trafficType: 'human' | 'bot' | 'unknown';
}

export interface AnalyticsBreakdowns {
  devices: Array<{ label: string; value: number }>;
  browsers: Array<{ label: string; value: number }>;
  operatingSystems: Array<{ label: string; value: number }>;
  languages: Array<{ label: string; value: number }>;
}

export interface LinkDetailsResponse {
  link: LinkRecord;
  overview: LinkOverviewAnalytics;
  recentClicks: LinkClickDetail[];
  breakdowns: AnalyticsBreakdowns;
}

export type AnalyticsModule = 'links' | 'pages' | 'live';
export type GlobalAnalyticsModuleFilter = 'all' | AnalyticsModule;

export interface GlobalAnalytics {
  totals: {
    clicks: number;
    views: number;
    uniqueVisitors: number;
    devices: number;
  };
  activityOverTime: Array<{
    date: string;
    label: string;
    clicks: number;
    views: number;
    uniqueVisitors: number;
  }>;
  modules: Array<{
    module: AnalyticsModule;
    clicks: number;
    views: number;
    uniqueVisitors: number;
  }>;
  activityByTime: Array<{
    day: number;
    hour: number;
    clicks: number;
    views: number;
    uniqueVisitors: number;
  }>;
  topReferrers: Record<GlobalAnalyticsModuleFilter, Array<{
    label: string;
    value: number;
  }>>;
  referrerTotals: Record<GlobalAnalyticsModuleFilter, number>;
  topSlugs: Record<GlobalAnalyticsModuleFilter, Array<{
    slug: string;
    module: AnalyticsModule;
    value: number;
  }>>;
  breakdowns: AnalyticsBreakdowns;
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

export type LiveActivityType = 'open_answer' | 'word_cloud' | 'multiple_choice' | 'scale';
export type LiveIdentityMode = 'anonymous' | 'named';
export type LiveActivityStatus = 'active' | 'closed';
export type LiveModerationMode = 'off' | 'filter_only' | 'review_all';
export type LiveResponseStatus = 'approved' | 'pending' | 'rejected';
export type ModerationMatchMode = 'whole_word' | 'contains';

export interface LiveQuestionOption {
  id: string;
  label: string;
  position: number;
}

export interface LiveActivityInput {
  title: string;
  question: string;
  type: LiveActivityType;
  slug?: string;
  status: LiveActivityStatus;
  identityMode: LiveIdentityMode;
  allowMultipleResponses: boolean;
  maxResponsesPerParticipant: number;
  moderationMode: LiveModerationMode;
  maxAnswerLength: number;
  allowMultipleChoices?: boolean;
  options?: string[];
  scaleMin?: number;
  scaleMax?: number;
  publicResults?: boolean;
  expirationValue?: number | null;
  expirationUnit?: 'minutes' | 'hours' | 'days';
}

export interface LiveActivitySummary {
  id: string;
  slug: string;
  publicUrl: string;
  title: string;
  question: string;
  type: LiveActivityType;
  status: LiveActivityStatus;
  identityMode: LiveIdentityMode;
  allowMultipleResponses: boolean;
  maxResponsesPerParticipant: number;
  moderationMode: LiveModerationMode;
  publicResults: boolean;
  expiresAt: string | null;
  maxAnswerLength: number;
  allowMultipleChoices: boolean;
  options: LiveQuestionOption[];
  scaleMin: number | null;
  scaleMax: number | null;
  responseCount: number;
  uniqueParticipantCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  createdAt: string;
  updatedAt: string;
  lastResponseAt: string | null;
  publicRevision: number;
}

export interface LiveResponseRecord {
  id: string;
  activityId: string;
  originalParticipantName: string | null;
  participantName: string | null;
  originalText: string | null;
  publishedText: string | null;
  selectedOptionIds: string[];
  scaleValue: number | null;
  status: LiveResponseStatus;
  moderationReason: string | null;
  editedByModerator: boolean;
  nameEditedByModerator: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LiveResultsSnapshot {
  activityId: string;
  slug: string;
  type: LiveActivityType;
  status: LiveActivityStatus;
  publicResults: boolean;
  responseCount: number;
  uniqueParticipantCount: number;
  openAnswers: Array<{
    id: string;
    text: string;
    participantName: string | null;
    editedByModerator: boolean;
    createdAt: string;
  }>;
  openAnswerTotal: number;
  openAnswerNextCursor: string | null;
  wordCloud: Array<{ text: string; count: number }>;
  wordCloudTotal: number;
  choices: Array<{ id: string; label: string; count: number; percentage: number }>;
  scale: {
    average: number | null;
    distribution: Array<{ value: number; count: number }>;
  } | null;
  revision: number;
}

export interface LiveAnalytics {
  totalViews: number;
  uniqueVisitors: number;
  viewsOverTime: Array<{ date: string; label: string; views: number; uniqueVisitors: number }>;
  breakdowns: AnalyticsBreakdowns;
  recentViews: AnalyticsVisitDetail[];
}

export interface LiveResultsDelta {
  type: 'delta';
  baseRevision: number;
  revision: number;
  status?: LiveActivityStatus;
  publicResults?: boolean;
  responseCount?: number;
  uniqueParticipantCount?: number;
  openAnswerTotal?: number;
  openAnswers?: {
    upsert: LiveResultsSnapshot['openAnswers'];
    removeIds: string[];
  };
  wordCloudTotal?: number;
  wordCloud?: {
    upsert: LiveResultsSnapshot['wordCloud'];
    removeKeys: string[];
  };
  choices?: LiveResultsSnapshot['choices'];
  scale?: LiveResultsSnapshot['scale'];
}

export interface LiveResultsPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface PublicLiveActivity {
  id: string;
  slug: string;
  publicUrl: string;
  title: string;
  question: string;
  type: LiveActivityType;
  status: LiveActivityStatus;
  identityMode: LiveIdentityMode;
  allowMultipleResponses: boolean;
  maxResponsesPerParticipant: number;
  maxAnswerLength: number;
  allowMultipleChoices: boolean;
  options: LiveQuestionOption[];
  scaleMin: number | null;
  scaleMax: number | null;
  publicResults: boolean;
  participantResponseCount: number;
  results: LiveResultsSnapshot | null;
}

export interface ModerationRule {
  id: string;
  pattern: string;
  matchMode: ModerationMatchMode;
  createdAt: string;
  updatedAt: string;
}

export type PageStatus = 'draft' | 'published' | 'disabled';
export type PageTheme = 'classic_cream' | 'forest_dark' | 'soft_lavender' | 'ocean_blue' | 'minimal_light';
export type PageLayout = 'classic' | 'minimal' | 'soft' | 'bold';
export type PageBlockType =
  | 'heading'
  | 'text'
  | 'link'
  | 'existing_link'
  | 'live_activity'
  | 'email'
  | 'divider'
  | 'spacer'
  | 'image'
  | 'double';

export type PageNestedBlockType = Exclude<PageBlockType, 'double'>;

export interface PageNestedBlock {
  id: string;
  type: PageNestedBlockType;
  config: PageBlockConfig;
  visible: boolean;
  href?: string | null;
  available?: boolean;
}

export interface PageBlockConfig {
  text?: string;
  title?: string;
  subtitle?: string;
  url?: string;
  email?: string;
  label?: string;
  emoji?: string;
  resourceId?: string;
  alignment?: 'left' | 'center' | 'right';
  size?: 'small' | 'medium' | 'large';
  style?: 'solid' | 'dashed' | 'dotted' | 'text' | 'button';
  spacing?: 'small' | 'medium' | 'large';
  openInNewTab?: boolean;
  alt?: string;
  caption?: string;
  children?: PageNestedBlock[];
}

export interface PageBlock {
  id: string;
  type: PageBlockType;
  config: PageBlockConfig;
  position: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
  href?: string | null;
  available?: boolean;
}

export interface PageInput {
  title: string;
  slug?: string;
  description?: string;
  emoji?: string;
  avatarUrl?: string;
  theme: PageTheme;
  layout: PageLayout;
  status: PageStatus;
  seoTitle?: string;
  seoDescription?: string;
  blocks: Array<{
    id?: string;
    type: PageBlockType;
    config: PageBlockConfig;
    visible: boolean;
  }>;
}

export interface PageSummary {
  id: string;
  slug: string;
  publicUrl: string;
  title: string;
  description: string | null;
  emoji: string | null;
  avatarUrl: string | null;
  theme: PageTheme;
  layout: PageLayout;
  status: PageStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  blockCount: number;
  totalViews: number;
  uniqueVisitors: number;
  totalLinkClicks: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageDetail extends PageSummary {
  blocks: PageBlock[];
}

export interface PageListResponse {
  items: PageSummary[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    totalPages: number;
    totalViews: number;
    uniqueVisitors: number;
  };
}

export interface PublicPage {
  id: string;
  slug: string;
  publicUrl: string;
  title: string;
  description: string | null;
  emoji: string | null;
  avatarUrl: string | null;
  theme: PageTheme;
  layout: PageLayout;
  blocks: PageBlock[];
}

export interface PageAnalytics {
  totalViews: number;
  uniqueVisitors: number;
  totalLinkClicks: number;
  viewsOverTime: Array<{ date: string; label: string; views: number; uniqueVisitors: number }>;
  blockClicks: Array<{
    blockId: string;
    label: string;
    clicks: number;
    url: string | null;
    type: 'link' | 'existing_link' | 'live_activity' | 'email';
  }>;
  breakdowns: AnalyticsBreakdowns;
  recentClicks: AnalyticsVisitDetail[];
}
