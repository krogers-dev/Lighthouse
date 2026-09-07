import React from 'react';

import { getRuntime } from '@/app-runtime';
import { HelpView } from '@/features/help/HelpView';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function HelpRoute(): React.JSX.Element {
  // Help is static content shipped with the app: no repository, no network
  // read, so it still works when the server cannot be reached.
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="help" testID="help-screen">
      <HelpView supportEmail={runtime.ok ? runtime.services.env.supportEmail : undefined} />
    </AuthorizedScreen>
  );
}
