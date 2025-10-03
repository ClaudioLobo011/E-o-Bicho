import type { PropsWithChildren } from "react";

export interface UnsavedGuardProps extends PropsWithChildren {
  isDirty?: boolean;
  onConfirm?: () => void;
}

export function UnsavedGuard({ children }: UnsavedGuardProps) {
  return <>{children}</>;
}

export default UnsavedGuard;
