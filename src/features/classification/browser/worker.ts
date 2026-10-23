import { createBrowserEngine } from './engine';

const engine = createBrowserEngine({
  onProgress: (status) => self.postMessage({ type: 'progress', status }),
});
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (
    !request ||
    typeof request !== 'object' ||
    !('id' in request) ||
    typeof request.id !== 'string' ||
    request.id.length > 100 ||
    !('type' in request)
  )
    return;
  const { id, type } = request;
  const run = async () => {
    switch (type) {
      case 'status':
        return engine.status();
      case 'check':
        return engine.check();
      case 'prepare':
        return engine.prepare();
      case 'infer':
        if (!('subject' in request) || typeof request.subject !== 'string')
          throw new Error('A subject is required.');
        return engine.infer(request.subject);
      case 'release':
        await engine.release();
        return null;
      case 'remove-model':
        await engine.removeModel();
        return null;
      default:
        throw new Error('Unknown local AI request.');
    }
  };
  void run().then(
    (data) => self.postMessage({ id, ok: true, data }),
    (error: unknown) =>
      self.postMessage({
        id,
        ok: false,
        error:
          error instanceof Error &&
          /^(Local AI|This subject|Download the model|A subject|Unknown local AI|Model download|Cancel the download|An unapproved|A model file|The model)/.test(
            error.message,
          )
            ? error.message
            : 'Local AI could not complete this request. Try again or choose a tag manually.',
      }),
  );
});
