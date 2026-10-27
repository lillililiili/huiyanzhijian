/** Deployment-owned URLs. Defaults preserve the current host, never a fixed loopback host. */
export function applicationUrl(application: 'admin' | 'business', route: string, base = window.location.href): string {
  const configured = application === 'admin' ? import.meta.env.VITE_ADMIN_APP_URL : import.meta.env.VITE_BUSINESS_APP_URL;
  const url = new URL(configured || base, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('应用地址必须使用 HTTP 或 HTTPS');
  if (!configured) { url.port = application === 'admin' ? '4182' : '4181'; url.pathname = '/'; }
  url.search = '';
  url.hash = route;
  return url.href;
}
