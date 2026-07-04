export default function middleware(request) {
  const url = new URL(request.url);
  const hostname = request.headers.get('host') || '';

  // 1. Pass through all API requests directly to support backend serverless routing
  if (url.pathname.startsWith('/api')) {
    return new Response(null, {
      headers: {
        'x-middleware-next': '1'
      }
    });
  }

  // 2. Identify if the request is arriving via an admin-designated subdomain/host
  // E.g., admin-aura-fitness.vercel.app, aura-fitness-admin.vercel.app, or localhost with admin port
  const isAdminHost = hostname.toLowerCase().includes('admin');

  if (isAdminHost) {
    // Internally rewrite path to serve from /admin directory if not already specified
    if (!url.pathname.startsWith('/admin')) {
      url.pathname = `/admin${url.pathname}`;
      return new Response(null, {
        headers: {
          'x-middleware-rewrite': url.toString()
        }
      });
    }
  }

  // 3. Continue standard routing for landing page / user download center
  return new Response(null, {
    headers: {
      'x-middleware-next': '1'
    }
  });
}
