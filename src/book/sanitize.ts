import DOMPurify from 'dompurify';

// Les livres viennent de l'extérieur : tout leur HTML passe par ici avant d'être affiché.
// Pas de styles, pas de formulaires, pas de scripts ; les liens externes s'ouvrent hors de l'app.
const FORBID_TAGS = ['style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'audio', 'video', 'source'];
const FORBID_ATTR = ['style', 'class', 'id', 'srcset'];
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|blob):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

let hooked = false;
function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

export function sanitizeHtml(html: string): string {
  ensureHooks();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: true,
  });
}
