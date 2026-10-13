// Present only so browsers treat the page as installable; it caches nothing and never answers a request itself,
// so every visit still loads the latest files and the live API.
self.addEventListener('fetch', () => {});
