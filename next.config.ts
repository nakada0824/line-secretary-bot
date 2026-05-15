import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // クリックジャッキング防止
          { key: 'X-Frame-Options', value: 'DENY' },
          // MIME スニッフィング防止
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // DNS プリフェッチ無効化
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          // リファラー制御
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 不要なブラウザ機能の無効化
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
