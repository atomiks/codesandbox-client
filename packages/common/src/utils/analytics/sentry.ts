import { Breadcrumb } from '@sentry/browser';
import VERSION from '../../version';
import { DO_NOT_TRACK_ENABLED } from './utils';

let _Sentry: typeof import('@sentry/browser');

function getSentry(): Promise<typeof import('@sentry/browser')> {
  return import(/* webpackChunkName: 'sentry' */ '@sentry/browser');
}

export async function initialize(dsn: string) {
  if (!DO_NOT_TRACK_ENABLED) {
    _Sentry = await getSentry();

    return _Sentry.init({
      dsn,
      release: VERSION,
      ignoreErrors: [
        'Custom Object', // Called for errors coming from sandbox (https://sentry.io/organizations/codesandbox/issues/965255074/?project=155188&query=is%3Aunresolved&statsPeriod=14d)
        'TypeScript Server Error', // Called from the TSC server
        /^Canceled$/, // Used by VSCode to stop currently running actions

        // Chrome extensions
        /extensions\//i,
        /^chrome:\/\//i,

        // react devtools Outside of our scope for now, but we definitely want to check this out.
        // TODO: check what's happening here: https://sentry.io/organizations/codesandbox/issues/1239466583/?project=155188&query=is%3Aunresolved+release%3APROD-1573653062-4134efc0a
        /because a node with that id is already in the Store/,
        /Node \d* was removed before its children\./,
        /Cannot remove node \d* because no matching node was found in the Store\./,
        /Cannot add child \d* to parent \d* because parent node was not found in the Store\./,
        /Children cannot be added or removed during a reorder operation\./,

        "undefined is not an object (evaluating 'window.__pad.performLoop')", // Only happens on Safari, but spams our servers. Doesn't break anything
      ],
      whitelistUrls: [/https?:\/\/((uploads|www)\.)?codesandbox\.io/],
      /**
       * Don't send messages from the sandbox, so don't send from eg.
       * new.codesandbox.io or new.csb.app
       */
      blacklistUrls: [
        'codesandbox.editor.main.js',
        /.*\.codesandbox\.io/,
        /.*\.csb\.app/,
      ],
      beforeSend: (event, hint) => {
        const exception = event?.exception?.values?.[0];
        const exceptionFrame = exception?.stacktrace?.frames?.[0];
        const filename = exceptionFrame?.filename;

        let errorMessage =
          typeof hint.originalException === 'string'
            ? hint.originalException
            : hint.originalException?.message || exception.value;

        if (typeof errorMessage !== 'string') {
          errorMessage = '';
        }

        if (filename) {
          if (
            filename.includes('typescript-worker') &&
            errorMessage.includes('too much recursion')
          ) {
            // https://sentry.io/organizations/codesandbox/issues/1293123855/events/b01ee0feb7e3415a8bb81b6a9df19152/?project=155188&query=is%3Aunresolved&statsPeriod=14d
            return null;
          }

          if (
            filename.endsWith('codesandbox.editor.main.js') ||
            filename.startsWith('/extensions/')
          ) {
            // This is the spammy event that doesn't do anything: https://sentry.io/organizations/codesandbox/issues/1054971728/?project=155188&query=is%3Aunresolved
            // Don't do anything with it right now, I can't seem to reproduce it for some reason.
            // We need to add sourcemaps
            return null;
          }
        }

        const customError = ((hint && (hint.originalException as any)) || {})
          .error;

        if (
          customError &&
          errorMessage.startsWith('Non-Error exception captured') &&
          exception.mechanism.handled
        ) {
          // This is an error coming from the sandbox, return with no error.
          return null;
        }

        if (errorMessage.includes('Unexpected frame by generating stack.')) {
          // A firefox error with error-polyfill, not critical. Referenced here: https://sentry.io/organizations/codesandbox/issues/1293236389/?project=155188&query=is%3Aunresolved
          return null;
        }

        return event;
      },
    });
  }

  return Promise.resolve();
}

export const logBreadcrumb = (breadcrumb: Breadcrumb) => {
  if (_Sentry) {
    _Sentry.addBreadcrumb(breadcrumb);
  }
};

export const captureException = err => {
  if (_Sentry) {
    _Sentry.captureException(err);
  }
};

export const configureScope = cb => {
  if (_Sentry) {
    _Sentry.configureScope(cb);
  }
};

export const setUserId = userId => {
  if (_Sentry) {
    _Sentry.configureScope(scope => {
      scope.setUser({ id: userId });
    });
  }
};

export const resetUserId = () => {
  if (_Sentry) {
    _Sentry.configureScope(scope => {
      scope.setUser({ id: undefined });
    });
  }
};
