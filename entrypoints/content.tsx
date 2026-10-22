import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createRoot } from 'react-dom/client';
import { GmailAdapter } from '../src/gmail/adapter';
import { ContentApp } from '../src/components/ContentApp';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import '../src/styles/app.css';

export default defineContentScript({
  matches: ['https://mail.google.com/mail/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    if (document.querySelector('vynlo-root')) return;
    const adapter = new GmailAdapter();
    const ui = await createShadowRootUi(ctx, {
      name: 'vynlo-root',
      position: 'overlay',
      anchor: 'body',
      // Keep typing in Vynlo from becoming a Gmail action after shadow retargeting.
      isolateEvents: true,
      onMount(container) {
        const root = createRoot(container);
        root.render(
          <ErrorBoundary>
            <ContentApp adapter={adapter} />
          </ErrorBoundary>,
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
        adapter.dispose();
      },
    });
    if (!ctx.isValid || document.querySelector('vynlo-root')) {
      adapter.dispose();
      return;
    }
    ui.mount();
    ctx.onInvalidated(() => ui.remove());
  },
});
