/**
 * Agentation Provider for Vanilla HTML/JS
 * Loads React, ReactDOM, and Agentation from CDN and mounts the toolbar
 */
(async () => {
  // Only render during local development
  const isLocal = 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' || 
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.');

  if (!isLocal) {
    return;
  }

  try {
    console.log('Loading Agentation extension...');
    
    // Load React and ReactDOM from ESM CDN
    const [React, ReactDOM, { Agentation }] = await Promise.all([
      import('https://esm.sh/react@18.3.1'),
      import('https://esm.sh/react-dom@18.3.1'),
      import('https://esm.sh/agentation@3?deps=react@18.3.1,react-dom@18.3.1')
    ]);

    // Create container for the React root
    const container = document.createElement('div');
    container.id = 'agentation-root';
    document.body.appendChild(container);

    // Mount the Agentation component
    const root = ReactDOM.createRoot(container);
    root.render(React.createElement(Agentation));
    
    console.log('Agentation extension loaded successfully.');
  } catch (err) {
    console.error('Failed to load Agentation extension:', err);
  }
})();
