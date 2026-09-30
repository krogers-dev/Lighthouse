/** React binding for the AuthController: one provider owns the boot call,
 * AppState wiring, and state fan-out. Routes stay thin by reading hooks. */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { AuthController, type AppStatus } from './controller';
import type { AuthState } from './machine';

interface AuthContextValue {
  state: AuthState;
  controller: AuthController;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toAppStatus(status: AppStateStatus): AppStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'background':
      return 'background';
    case 'inactive':
      return 'inactive';
    case 'extension':
      return 'extension';
    default:
      return 'unknown';
  }
}

export function AuthProvider({
  controller,
  children,
}: {
  controller: AuthController;
  children: React.ReactNode;
}): React.JSX.Element {
  const [state, setState] = useState<AuthState>(() => controller.getState());

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      controller.handleAppStateChange(toAppStatus(next)),
    );
    void controller.boot();
    return () => subscription.remove();
  }, [controller]);

  return <AuthContext.Provider value={{ state, controller }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth requires an AuthProvider ancestor');
  }
  return value;
}

export function useAuthState(): AuthState {
  return useAuth().state;
}

export function useAuthController(): AuthController {
  return useAuth().controller;
}
