import React from 'react';

import { useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { Notice, Screen } from '@/ui';

export default function FatalRoute(): React.JSX.Element {
  const state = useAuthState();
  const redirect = guardRedirect(state, 'fatal');
  if (redirect) return redirect;
  return (
    <Screen testID="fatal-screen">
      <Notice
        tone="danger"
        title="HIVE stopped to keep your information safe"
        body="HIVE hit a problem it could not recover from and stopped to keep your information safe. Close the app fully and open it again. If this keeps happening, contact your Honeybee team."
      />
    </Screen>
  );
}
