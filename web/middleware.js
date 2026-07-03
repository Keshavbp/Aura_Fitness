export default function middleware(request) {
  // Pass through all requests directly to support standard subdirectory hosting without subdomains
  return new Response(null, {
    headers: {
      'x-middleware-next': '1'
    }
  });
}
