import type { MetadataRoute } from 'next';
import { resolveCanonicalOrigin } from '@/lib/social-metadata';

export default function robots(): MetadataRoute.Robots {
  const origin = resolveCanonicalOrigin();

  const publicAllow = [
    '/',
    '/anime/',
    '/watch/',
    '/explore',
    '/trending',
    '/popular',
    '/recent',
    '/schedule',
    '/genres',
    '/search',
    '/api/og/',
    '/api/artwork-image/',
  ];

  const privateDisallow = [
    '/admin',
    '/api/admin/',
    '/api/bot/',
    '/api/discord/',
    '/api/auth/',
    '/api/profile/',
    '/api/reports/',
    '/api/stream/',
    '/api/skips/',
    '/api/subtitles/',
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: publicAllow,
        disallow: privateDisallow,
      },
      {
        userAgent: [
          'Discordbot',
          'facebookexternalhit',
          'Twitterbot',
          'WhatsApp',
          'TelegramBot',
          'Slackbot-LinkExpanding',
          'redditbot',
        ],
        allow: publicAllow,
        disallow: ['/admin', '/api/admin/', '/api/bot/', '/api/discord/'],
      },
    ],
    host: origin,
  };
}
