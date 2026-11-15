export const getLinkFaviconCandidates = (targetUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return [];
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return [];

  const origin = parsed.origin;
  const isSharePoint = /(^|\.)sharepoint\.com$/i.test(parsed.hostname);
  if (isSharePoint) {
    return [
      `${origin}/_layouts/15/images/odbfavicon.ico`,
      `${origin}/favicon.ico`,
      `${origin}/favicon.png`,
      `${origin}/odbfavicon.ico`
    ];
  }

  return [
    `${origin}/favicon.ico`,
    `${origin}/favicon.png`,
    `${origin}/odbfavicon.ico`
  ];
};
