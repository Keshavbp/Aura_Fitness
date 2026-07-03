import { next, rewrite } from '@vercel/functions';

export default function middleware(request) {
  const url = new URL(request.url);
  const hostname = request.headers.get('host') || '';

  // Determine if we are on the admin subdomain
  // Matches admin.localhost, admin.aurafitness.com, etc.
  const isAdminSubdomain = hostname.startsWith('admin.');

  if (isAdminSubdomain) {
    // Internally rewrite requests to serve from the /admin subfolder
    if (!url.pathname.startsWith('/admin')) {
      // E.g., admin.localhost:3000/app.js -> /admin/app.js
      url.pathname = `/admin${url.pathname}`;
    }
    // Return a transparent rewrite
    return rewrite(url);
  } else {
    // If accessing the admin subdirectory from the root domain,
    // redirect to the admin subdomain
    if (url.pathname.startsWith('/admin')) {
      const redirectUrl = new URL(request.url);
      
      // Construct the subdomain hostname
      if (hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1')) {
        redirectUrl.hostname = 'admin.localhost';
      } else {
        // Strip leading www. if present and prefix with admin.
        const cleanHost = hostname.replace(/^www\./, '');
        redirectUrl.hostname = `admin.${cleanHost}`;
      }
      
      // Strip the '/admin' prefix for the subdomain root
      // E.g., aurafitness.com/admin/dashboard -> admin.aurafitness.com/dashboard
      let cleanPath = url.pathname.substring(6);
      if (!cleanPath.startsWith('/')) {
        cleanPath = '/' + cleanPath;
      }
      redirectUrl.pathname = cleanPath;

      return Response.redirect(redirectUrl, 301);
    }
  }

  // Continue standard routing for main domain public site
  return next();
}
