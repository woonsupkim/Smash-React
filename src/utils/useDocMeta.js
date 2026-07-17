// Per-page <title> + meta description, the same pattern Rivalry.js proved
// out: set on mount/update, restore the previous values on unmount so
// navigating away never leaves a stale title behind. An SPA without this
// shows one generic title on every page - bad for search snippets, bookmarks,
// and browser history alike.
import { useEffect } from 'react';

export default function useDocMeta(title, description) {
  useEffect(() => {
    if (!title) return undefined;
    const prev = document.title;
    document.title = title;
    const desc = document.querySelector('meta[name="description"]');
    const prevDesc = desc?.getAttribute('content');
    if (description) desc?.setAttribute('content', description);
    return () => {
      document.title = prev;
      if (prevDesc) desc?.setAttribute('content', prevDesc);
    };
  }, [title, description]);
}
