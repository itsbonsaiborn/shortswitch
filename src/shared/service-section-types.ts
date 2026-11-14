export const serviceSectionTypes = ['about', 'security', 'privacy', 'contacts'] as const;

export type ServiceSectionType = (typeof serviceSectionTypes)[number];

export interface ServiceSectionContent {
  titleEn: string;
  bodyEn: string;
  titleLv: string;
  bodyLv: string;
}

export interface ServiceSectionDefinition extends ServiceSectionContent {
  type: ServiceSectionType;
  publicPath: string;
  required: boolean;
}

export interface ServiceSectionAdmin extends ServiceSectionContent {
  type: ServiceSectionType;
  publicPath: string;
  required: boolean;
  enabled: boolean;
  showInFooter: boolean;
  published: boolean;
  needsReview: boolean;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  publishedAt: string | null;
  contactConfig?: ServiceContactConfig;
}

export interface ServiceSectionUpdate extends ServiceSectionContent {
  enabled: boolean;
  showInFooter: boolean;
  contactConfig?: ServiceContactConfig;
}

export interface ServiceFooterLink {
  type: ServiceSectionType | 'report_abuse';
  label: string;
  href: string;
}

export interface PublicServiceSection {
  type: ServiceSectionType;
  title: string;
  body: string;
  publicPath: string;
  fallback: boolean;
  contactConfig?: ServiceContactConfig;
}

export const serviceContactBlockTypes = ['heading', 'text', 'contact_email', 'social_card', 'divider', 'contact_form'] as const;
export type ServiceContactBlockType = (typeof serviceContactBlockTypes)[number];
export type ServiceContactIcon = 'website' | 'linkedin' | 'facebook' | 'instagram' | 'youtube' | 'x' | 'github' | 'other';

interface ServiceContactBlockBase {
  id: string;
  type: ServiceContactBlockType;
}

export type ServiceContactBlock =
  | (ServiceContactBlockBase & { type: 'heading'; titleEn: string; titleLv: string })
  | (ServiceContactBlockBase & { type: 'text'; bodyEn: string; bodyLv: string })
  | (ServiceContactBlockBase & { type: 'contact_email'; titleEn: string; titleLv: string; email: string })
  | (ServiceContactBlockBase & {
      type: 'social_card'; titleEn: string; titleLv: string; descriptionEn: string; descriptionLv: string;
      icon: ServiceContactIcon; url: string;
    })
  | (ServiceContactBlockBase & { type: 'divider' })
  | (ServiceContactBlockBase & { type: 'contact_form'; titleEn: string; titleLv: string; descriptionEn: string; descriptionLv: string });

export interface ServiceContactConfig {
  blocks: ServiceContactBlock[];
}

export const createDefaultServiceContactConfig = (content: ServiceSectionContent): ServiceContactConfig => ({
  blocks: [
    { id: 'contacts-default-text', type: 'text', bodyEn: content.bodyEn, bodyLv: content.bodyLv },
    {
      id: 'contacts-system-form',
      type: 'contact_form',
      titleEn: 'Contact form',
      titleLv: 'Saziņas forma',
      descriptionEn: 'The contact form will be available in a future update.',
      descriptionLv: 'Saziņas veidlapa būs pieejama nākamajā atjauninājumā.'
    }
  ]
});

export const serviceSectionDefinitions: readonly ServiceSectionDefinition[] = [
  {
    type: 'about',
    publicPath: '/service/about',
    required: false,
    titleEn: 'About ShortSwitch',
    bodyEn: 'ShortSwitch is a self-hosted educational platform for short links, public pages, activities, and collaborative boards.\n\nAdministrator review required: adapt this description to your deployment before publication.',
    titleLv: 'Par ShortSwitch',
    bodyLv: 'ShortSwitch ir pašmitināta izglītības platforma īsajām saitēm, publiskajām lapām, aktivitātēm un sadarbības tāfelēm.\n\nNepieciešama administratora pārbaude: pirms publicēšanas pielāgojiet šo aprakstu savai videi.'
  },
  {
    type: 'security',
    publicPath: '/service/security',
    required: true,
    titleEn: 'Security Policy',
    bodyEn: 'This page is reserved for security information and responsible vulnerability reporting instructions.\n\nAdministrator review required: add a monitored reporting channel and deployment-specific guidance. No security contact is configured by default.',
    titleLv: 'Drošības politika',
    bodyLv: 'Šī lapa ir paredzēta drošības informācijai un norādījumiem par atbildīgu ievainojamību ziņošanu.\n\nNepieciešama administratora pārbaude: pievienojiet uzraudzītu ziņošanas kanālu un videi atbilstošus norādījumus. Drošības kontaktinformācija pēc noklusējuma nav norādīta.'
  },
  {
    type: 'privacy',
    publicPath: '/service/privacy',
    required: true,
    titleEn: 'Privacy Policy',
    bodyEn: 'This page must be reviewed and updated by the operator to describe how this ShortSwitch deployment handles personal data, analytics, retention, and participant content.\n\nNo deployment-specific legal or privacy statement is configured by default.',
    titleLv: 'Privātuma politika',
    bodyLv: 'Operatoram šī lapa ir jāpārskata un jāatjaunina, aprakstot, kā konkrētā ShortSwitch vide apstrādā personas datus, analītiku, glabāšanas termiņus un dalībnieku saturu.\n\nVidei specifisks juridisks vai privātuma paziņojums pēc noklusējuma nav konfigurēts.'
  },
  {
    type: 'contacts',
    publicPath: '/service/contacts',
    required: true,
    titleEn: 'Contacts',
    bodyEn: 'Operator contact details have not been configured.\n\nAdministrator review required: add a monitored contact method before relying on this page for support or safety reports.',
    titleLv: 'Kontakti',
    bodyLv: 'Operatora kontaktinformācija nav konfigurēta.\n\nNepieciešama administratora pārbaude: pirms izmantot šo lapu atbalsta vai drošības ziņojumiem, pievienojiet uzraudzītu saziņas veidu.'
  }
] as const;

export const isServiceSectionType = (value: string): value is ServiceSectionType =>
  serviceSectionTypes.includes(value as ServiceSectionType);

export const getServiceSectionDefinition = (type: ServiceSectionType) =>
  serviceSectionDefinitions.find((definition) => definition.type === type)!;
